import pandas as pd
import json
import re
from pathlib import Path


# =========================
# CONFIGURATION
# =========================
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
EXCEL_FILE = SCRIPT_DIR / "Grade 10.xlsx"
# Change to:
# "Subjects-Grade10.xlsx"
# "Subjects-Grade12.xlsx"
# etc.

# =========================
# PROCESSING LOGIC
# =========================
def excel_to_master_json(excel_path: Path):

    print("Looking for:", excel_path)
    print("Exists:", excel_path.exists())

    xls = pd.ExcelFile(excel_path)
    master_records = []

    for sheet_name in xls.sheet_names:
        df = pd.read_excel(xls, sheet_name=sheet_name, header=None)

        # Attempt to extract metadata
        try:
            subject = str(df.iloc[3, 3]).strip()
            teacher = str(df.iloc[3, 3]).strip()
            
            # group_line = str(df.iloc[2, 3])
            line_match = re.search(r"\bLINE\s*(\d+)\b", subject, re.IGNORECASE)
            line = line_match.group(1) if line_match else None

            if not line:
                raise ValueError(f"No LINE number found in subject: {subject}")

        except Exception:
            # Skip malformed sheets
            continue

        
        # line_match = re.search(r"LINE\s+(\d+)", group_line)
        # line = line_match.group(1) if line_match else None

        # Find the table header row ("NO")
        header_rows = df.index[df.iloc[:, 0] == "NO"]
        if len(header_rows) == 0:
            continue

        header_row = header_rows[0]

        # Extract student rows
        data = df.iloc[header_row + 1:].dropna(subset=[0])
        data.columns = ["NO", "ADMNR", "NAME", "GENDER", "CLASS"]

        for _, row in data.iterrows():
            master_records.append({
                "student_number": int(row.ADMNR),
                "name": str(row.NAME).strip(),
                "gender": str(row.GENDER).strip(),
                "class": str(row.CLASS).strip(),
                "subject": subject,
                "line": line,
                "teacher": teacher,
                "sheet": sheet_name
            })

    return master_records


# =========================
# OUTPUT
# =========================
if __name__ == "__main__":
    excel_path = Path(EXCEL_FILE)
    records = excel_to_master_json(excel_path)



    output_file = excel_path.with_name(
        excel_path.stem + "_Master_Subjects.json"
    )

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    print(f"✔ Created {output_file.name}")
    print(f"✔ Total records: {len(records)}")
