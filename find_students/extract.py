import pandas as pd
import json
from pathlib import Path


# =========================
# FILE CONFIG
# =========================
SCRIPT_DIR = Path(__file__).resolve().parent
INPUT_FILE = SCRIPT_DIR / "school.xlsx"
OUTPUT_FILE = SCRIPT_DIR / "students.json"


# =========================
# HELPERS
# =========================
def normalise(col: str) -> str:
    """Normalise column names for matching."""
    return (
        str(col)
        .strip()
        .lower()
        .replace(" ", "")
        .replace("_", "")
    )


# =========================
# LOAD & INSPECT EXCEL
# =========================
xls = pd.ExcelFile(INPUT_FILE)

print("✔ Sheets found:", xls.sheet_names)

df = None
used_sheet = None

for sheet in xls.sheet_names:
    temp = pd.read_excel(xls, sheet_name=sheet)

    print(f"\n--- Inspecting sheet: {sheet} ---")
    print("Raw columns:", list(temp.columns))

    if len(temp.columns) > 1:
        df = temp
        used_sheet = sheet
        break

if df is None:
    raise ValueError("No usable sheet found in school.xlsx")

print(f"\n✔ Using sheet: {used_sheet}")


# =========================
# NORMALISE COLUMNS
# =========================
df.columns = [normalise(c) for c in df.columns]

print("Normalised columns:", df.columns.tolist())


# =========================
# COLUMN MAPPING
# =========================
COLUMN_MAP = {
    "adminno": "adminno",
    "admnr": "adminno",
    "admissionno": "adminno",

    "firstname": "firstname",
    "names": "firstname",
    "name": "firstname",

    "surname": "lastname",
    "lastname": "lastname",

    "grade": "grade",

    "class": "class",
    "regclass": "class",
    "registrationclass": "class"
}

renamed = {}
for col in df.columns:
    if col in COLUMN_MAP:
        renamed[col] = COLUMN_MAP[col]

df = df.rename(columns=renamed)

print("Mapped columns:", df.columns.tolist())


# =========================
# VALIDATION
# =========================
required = {"adminno", "firstname", "lastname", "grade", "class"}
missing = required - set(df.columns)

if missing:
    print("\n❌ COLUMN VALIDATION FAILED")
    print("Sheet:", used_sheet)
    print("Available columns:", df.columns.tolist())
    raise ValueError(f"Missing required columns: {missing}")


# =========================
# TRANSFORM ROWS
# =========================
students = []
errors = []

for idx, row in df.iterrows():
    try:
        admin_no = str(row["adminno"]).strip()
        if not admin_no:
            raise ValueError("Empty admin number")

        students.append({
            "adminNo": admin_no,
            "firstName": str(row["firstname"]).strip(),
            "lastName": str(row["lastname"]).strip(),
            "registrationClass": f"GRADE {row['grade']} {row['class']}",
            "photo": f"{admin_no}.jpg"
        })

    except Exception as e:
        # +2 accounts for header row and 0-index
        errors.append(f"Row {idx + 2}: {e}")


# =========================
# REPORT ROW ERRORS
# =========================
if errors:
    print("\n⚠️ Row-level issues detected:")
    for e in errors[:10]:
        print(" ", e)
    if len(errors) > 10:
        print(f" ... and {len(errors) - 10} more")


# =========================
# SAVE JSON
# =========================
with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(students, f, indent=2, ensure_ascii=False)

print(f"\n✔ Created {OUTPUT_FILE.name}")
print(f"✔ Total students written: {len(students)}")
print(f"✔ Rows skipped due to errors: {len(errors)}")
