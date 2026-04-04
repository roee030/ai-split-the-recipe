import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {setGlobalOptions} from "firebase-functions/v2";
import * as admin from "firebase-admin";
import * as https from "https";
import {callGemini} from "./gemini";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({maxInstances: 10});

/**
 * Anthropic proxy — forwards browser requests to api.anthropic.com.
 *
 * Why: Anthropic blocks direct browser-to-API calls (no CORS headers).
 * This function runs server-side, so no CORS restriction applies.
 *
 * Route: POST /api/anthropic/v1/messages
 *   → forwards to https://api.anthropic.com/v1/messages
 *
 * The API key is read from a Firebase secret so it never
 * appears in the client bundle.
 */
export const anthropicProxy = onRequest(
  {secrets: ["ANTHROPIC_API_KEY"]},
  (req, res) => {
    // CORS preflight
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, anthropic-version");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY secret not set");
      res.status(500).send("Proxy misconfigured");
      return;
    }

    const body = JSON.stringify(req.body);

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "x-api-key": apiKey,
        "anthropic-version":
          (req.headers["anthropic-version"] as string) ?? "2023-06-01",
      },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.status(proxyRes.statusCode ?? 500);
      proxyRes.pipe(res, {end: true});
    });

    proxyReq.on("error", (err) => {
      console.error("Proxy request failed", err);
      res.status(502).send("Bad Gateway");
    });

    proxyReq.write(body);
    proxyReq.end();
  }
);

export const scanReceipt = onCall(
  {timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    // 1. Require authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }
    const uid = request.auth.uid;

    // 2. Check scan quota
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.data() ?? {};
    const scansUsed: number = (userData.scansUsed as number) ?? 0;
    const isPremium: boolean = (userData.isPremium as boolean) ?? false;

    if (scansUsed >= 5 && !isPremium) {
      throw new HttpsError("resource-exhausted", "SCAN_LIMIT_REACHED");
    }

    // 3. Validate input
    const {imageBase64, mimeType} = request.data as {
      imageBase64: string;
      mimeType: string;
    };
    if (!imageBase64 || !mimeType) {
      throw new HttpsError(
        "invalid-argument",
        "imageBase64 and mimeType required"
      );
    }

    const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new HttpsError('invalid-argument', `Unsupported image type: ${mimeType}`);
    }

    // 4. Call Gemini
    const apiKey = process.env.GEMINI_API_KEY ?? "";
    if (!apiKey) {
      throw new HttpsError("internal", "Gemini API key not configured");
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = (await callGemini(
        imageBase64,
        mimeType,
        apiKey
      )) as Record<string, unknown>;
    } catch (e) {
      console.error('Gemini call failed:', e);
      throw new HttpsError("internal", "Gemini call failed");
    }

    if (parsed.error) {
      throw new HttpsError("invalid-argument", parsed.error as string);
    }

    // 5 & 6. Atomically increment scansUsed and save scan record
    const items =
      (parsed.items as Array<Record<string, unknown>>) ?? [];
    const batch = db.batch();

    // Update user doc
    batch.set(userRef, {
      scansUsed: admin.firestore.FieldValue.increment(1),
      email: request.auth.token.email ?? null,
      displayName: request.auth.token.name ?? null,
    }, {merge: true});

    // Save scan to history
    const scanRef = userRef.collection("scans").doc();
    batch.set(scanRef, {
      createdAt: admin.firestore.Timestamp.now(),
      restaurantName: parsed.restaurant_name ?? null,
      currency: parsed.currency ?? "ILS",
      total: items.reduce(
        (s: number, i: Record<string, unknown>) =>
          s + ((i.total_price as number) ?? 0),
        0
      ),
      itemCount: items.length,
      items: items,
      confidence: parsed.confidence ?? "medium",
    });

    await batch.commit();

    // 7. Return parsed receipt to client
    return parsed;
  }
);
