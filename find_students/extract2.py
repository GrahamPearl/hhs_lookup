import pandas as pd
import json
import re
from pathlib import Path

# =========================
# FILE CONFIG
# =========================

SCRIPT_DIR = Path(__file__).resolve().parent
INPUT_FILE = SCRIPT_DIR / "school.xlsx"
OUTPUT_FILE = SCRIPT_DIR / "students.json"

HEADER_ROW_INDEX = 6  # Excel row 8

# =========================
# HELPERS
# =========================

def normalise(col: str) -> str:
    return (
        str(col)
        .strip()
        .lower()
        .replace(" ", "")
        .replace("_", "")
        .replace("/", "")
        .replace("[", "")
        .replace("]", "")
    )

def parse_grade_and_class(text: str):
    grade = None
    class_code = None

    grade_match = re.search(r"grade\s*(\d+)", text, re.I)
    class_match = re.search(r"\b(\d+[A-Z]+)\b", text)

    if grade_match:
        grade = grade_match.group(1)
    if class_match:
        class_code = class_match.group(1)

    return grade, class_code

# =========================
# COLUMN MAPPING (ROW 8)
# =========================

COLUMN_MAP = {
    "admno": "adminNo",
    "surname": "lastName",

    # Preferred name is the first name
    "preferredname": "firstName",

    # Gender
    "g": "gender",

    # NEW FIELDS  (keys must be normalised — matching what normalise() produces)
    "agegroup": "agegroup",
    "bdate": "birthdate",
}

# =========================
# PROCESS ALL SHEETS
# =========================

xls = pd.ExcelFile(INPUT_FILE)
print("✔ Sheets found:", xls.sheet_names)

students = []
errors = []

for sheet_name in xls.sheet_names:
    try:
        df = pd.read_excel(
            INPUT_FILE,
            sheet_name=sheet_name,
            header=HEADER_ROW_INDEX
        )

        if df.empty:
            continue

        # Normalise headers
        df.columns = [normalise(c) for c in df.columns]

        # Rename to canonical names
        df = df.rename(columns={
            col: COLUMN_MAP[col]
            for col in df.columns
            if col in COLUMN_MAP
        })

        required = {
            "adminNo",
            "firstName",
            "lastName",
            "gender",
            "agegroup",
            "birthdate"
        }

        missing = sorted(required - set(df.columns))

        if missing:
            print(f"⚠️ Sheet skipped: {sheet_name}")
            print(f"   Missing columns: {', '.join(missing)}")
            print(f"   Found columns: {', '.join(sorted(df.columns))}\n")
            continue

        registration_class = sheet_name.strip()
        grade, class_code = parse_grade_and_class(registration_class)

        for idx, row in df.iterrows():
            try:
                admin_no = str(row["adminNo"]).strip()
                if admin_no.lower() == "nan" or admin_no == "":
                    continue

                gender = str(row["gender"]).strip().upper()
                gender = "M" if gender.startswith("M") else "F"
                
                birthdate_raw = row["birthdate"]
                if pd.notna(birthdate_raw):
                    # Already a YYYY-MM-DD string from Excel; normalise via
                    # to_datetime only to handle any edge-case numeric serials.
                    parsed = pd.to_datetime(str(birthdate_raw).strip(), errors="coerce")
                    birthdate = parsed.strftime("%Y-%m-%d") if parsed is not pd.NaT else None
                else:
                    birthdate = None

                student = {
                    "adminNo": admin_no,
                    "firstName": str(row["firstName"]).strip(),
                    "lastName": str(row["lastName"]).strip(),
                    "grade": grade,
                    "class": class_code,
                    "gender": gender,
                    "agegroup": str(row["agegroup"]).strip(),
                    "birthdate": birthdate,
                    "registrationClass": registration_class,
                    "photo": f"{admin_no}.webp"
                }

                students.append(student)

            except Exception as e:
                errors.append(f"{sheet_name} row {idx + 9}: {e}")

    except Exception as e:
        print(f"❌ Failed to process sheet {sheet_name}: {e}")

# =========================
# SAVE OUTPUT
# =========================

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(students, f, indent=2, ensure_ascii=False)

print("\n✔ students.json created")
print(f"✔ Total students written: {len(students)}")
print(f"⚠️ Rows skipped due to errors: {len(errors)}")

if errors:
    print("\nFirst 10 issues:")
    for e in errors[:10]:
        print(" ", e)