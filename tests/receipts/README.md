# Regression Test Receipts

Drop receipt images here alongside a matching `.expected.json` golden file.

## File naming

```
receipt-restobar-2024.jpg          ← the image
receipt-restobar-2024.expected.json ← the golden file
```

## Golden file format

```json
{
  "restaurantName": "מסעדת הגן",
  "items": [
    { "name": "קוקה קולה",        "quantity": 1, "total_price": 16   },
    { "name": "כ. לימונדה",       "quantity": 2, "total_price": 30   },
    { "name": "בקבוק ערק",        "quantity": 1, "total_price": 600  },
    { "name": "מים מינרלים גדול", "quantity": 1, "total_price": 24   },
    { "name": "סלט תפוחי אדמה",   "quantity": 1, "total_price": 22   },
    { "name": "לחם פסח",          "quantity": 1, "total_price": 24   },
    { "name": "סשימי דג",         "quantity": 1, "total_price": 68   },
    { "name": "רוסטביף סינטה",    "quantity": 2, "total_price": 136  },
    { "name": "קבב טלה",          "quantity": 1, "total_price": 78   },
    { "name": "לברק ירוקים",      "quantity": 1, "total_price": 96   },
    { "name": "שיפוד נתח קצבים",  "quantity": 1, "total_price": 122  },
    { "name": "המבורגר",           "quantity": 1, "total_price": 96   },
    { "name": "קרמו שוקולד",       "quantity": 2, "total_price": 96   },
    { "name": "פריט כללי מטבח",   "quantity": 1, "total_price": 713  }
  ],
  "corrections": {
    "שטיחי דג":        "סשימי דג",
    "בורגר ירוקים":    "לברק ירוקים",
    "שפוד פרגיות קצבים": "שיפוד נתח קצבים",
    "פרטי כלכלי מטבח": "פריט כללי מטבח"
  }
}
```

## `corrections` field

The `corrections` map is the **learning engine input**.
If the OCR outputs a key (e.g. `"שטיחי דג"`) and the golden value says it should be `"סשימי דג"`,
the regression suite will print a suggested entry for `correctionDictionary.ts`.

## Running

```bash
# Standard run
npm run regression

# Threshold benchmark (tests contrast ×0.8 / ×1.0 / ×1.2)
npm run regression:bench
```
