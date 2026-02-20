# extract.py  — Excel → Master JSON (with subject normalization and Tourism fix)
# Hillcrest High School — Subject Extraction

import json
import re
import difflib
from pathlib import Path
import pandas as pd

# =========================
# CONFIGURATION
# =========================
SCRIPT_DIR = Path(__file__).resolve().parent

# Set to the workbook you are processing, e.g.:
# "Subjects-Grade10.xlsx", "Subjects-Grade11.xlsx", etc.
EXCEL_FILE = SCRIPT_DIR / "Grade 10.xlsx"

# Canonical subject list (one subject per line)
SUBJECTS_TXT = SCRIPT_DIR / "list_of_subjects.txt"

# =========================
# SUBJECT NORMALIZATION
# =========================

# Known abbreviations or tokens from messy subject strings
ABBR = {
    "ENGHL": "English Home Language",
    "EGD": "Engineering Graphics and Design",
    "LS": "Life Science",
    "DRAMA": "Dramatic Arts",
    "IT": "Information Technology",
    "MATH LIT": "Mathematical Literacy",
    "MATHEMATICAL LITERACY": "Mathematical Literacy",
    "MATHEMATICS": "Mathematics",
    "M":"Mathematics",
    "MA":"Mathematics",
    "MAT":"Mathematics",
    "TOURISM": "Tourism",
    "VISUAL ARTS": "Visual Arts",
    "ENGLISH HOME LANGUAGE": "English Home Language",
    "LIFE SCIENCE": "Life Science",
    "LIFE SCIENCES": "Life Science",
}

def _norm(s: str) -> str:
    """Upper-case and collapse spaces."""
    return re.sub(r"\s+", " ", (s or "").strip().upper())

def load_subject_list(path: Path) -> list[str]:
    """Load the official subjects.txt list."""
    subjects = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if s:
                subjects.append(s)
    return subjects

def trim_trailing_grade(raw: str) -> str:
    """
    Remove trailing '(Gr 10)', '(Gr 11)', '(GR 12)', etc.
    Applies only at end of string.
    """
    if not raw:
        return ""
    return re.sub(r"\s*\(\s*Gr\s*\d+\s*\)\s*$", "", raw, flags=re.I).strip()

def clean_raw_subject(raw: str) -> str:
    """
    Remove Group:, Line references, teacher names, class codes, etc.
    Leaves only the meaningful subject words before running matching.
    """
    if not raw:
        return ""
    s = raw

    # D5 contains subject + "(Gr 10)", so remove that early
    s = trim_trailing_grade(s)

    # Remove 'Group:' prefix
    s = re.sub(r"^\s*Group:\s*", "", s, flags=re.I)

    # Remove "LINE 7", "LINE: 5", etc.
    s = re.sub(r"\bLINE\s*[:=]?\s*\d+\b", "", s, flags=re.I)

    # Remove trailing year/class fragments ("10.1", "10A", etc.)
    s = re.sub(r"\b(10|11|12)\.?\d*\b", "", s)

    # Remove trailing surname tokens after line numbers
    s = re.sub(r"\b([A-Z][a-z]+)\b$", "", s).strip()

    # Remove any "(Gr ... )" fragments again (including partial)
    s = re.sub(r"\(.*?Gr\s*\d+.*?\)", "", s, flags=re.I)

    # Collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()

    return s

def subject_hint_from_sheet(sheet_name: str) -> str:
    """
    Use left side of sheet name as fallback to detect subject.
    Example: 'Tourism (Gr 10) - LINE 5' → 'Tourism'
    """
    if not sheet_name:
        return ""
    left = sheet_name.split(" - ")[0].strip()
    left = trim_trailing_grade(left)
    return left.strip()

def match_subject(raw_subject: str, official_subjects: list[str], *, fallback_hint: str = "") -> str:
    """
    Resolve subject to official list with fallback to sheet name.
    Priority order:
      0) Fallback hint (sheet tab)
      1) Direct match
      2) Abbreviations
      3) Contains check
      4) Startswith check
      5) Fuzzy match
      6) Fallback to cleaned title-case
    """

    cleaned = clean_raw_subject(raw_subject)
    offic_norm = {_norm(s): s for s in official_subjects}

    # 0) Fallback hint first — this fixes Tourism immediately.
    if fallback_hint:
        fh = _norm(fallback_hint)
        if fh in offic_norm:
            return offic_norm[fh]

    cleaned_up = _norm(cleaned) if cleaned else ""

    # --- Mathematics special-case expansion ---
    # If the cleaned subject starts with a math prefix, force Mathematics.
    math_prefixes = {"M", "MA", "MAT", "MATH", "MATHS"}
    if cleaned_up in math_prefixes or any(cleaned_up.startswith(p) for p in math_prefixes):
        for s in official_subjects:
            if _norm(s) == "MATHEMATICS":
                return s

    # 1) Direct match
    if cleaned_up in offic_norm:
        return offic_norm[cleaned_up]

    # 2) Abbreviation
    if cleaned_up in ABBR:
        alias = ABBR[cleaned_up]
        alias_norm = _norm(alias)
        return offic_norm.get(alias_norm, alias)

    # 3) Contains check
    for s in official_subjects:
        if _norm(s) in cleaned_up:
            return s

    # 4) Startswith
    if cleaned_up:
        first = cleaned_up.split()[0]
        for s in official_subjects:
            if _norm(s).startswith(first):
                return s

    # 5) Fuzzy match
    if cleaned_up:
        candidates = list(offic_norm.keys())
        best = difflib.get_close_matches(cleaned_up, candidates, n=1, cutoff=0.80)
        if best:
            return offic_norm[best[0]]

    # 6) Final fallback
    return (cleaned or fallback_hint).title()

def parse_line(*raw_candidates: str) -> str | None:
    """Extract LINE number from any candidate strings."""
    for raw in raw_candidates:
        if not raw:
            continue
        m = re.search(r"\bLINE\s*[:=]?\s*(\d{1,2})\b", str(raw), flags=re.I)
        if m:
            return m.group(1)
    return None

# =========================
# EXTRACTION
# =========================
def excel_to_master_json(excel_path: Path, subjects_txt: Path) -> list[dict]:
    print("Looking for:", excel_path)
    print("Exists:", excel_path.exists())

    official_subjects = load_subject_list(subjects_txt)

    # Load workbook using openpyxl engine
    xls = pd.ExcelFile(excel_path, engine="openpyxl")

    master_records: list[dict] = []

    for sheet_name in xls.sheet_names:
        df = pd.read_excel(xls, sheet_name=sheet_name, header=None, engine="openpyxl")

        # ---- SUBJECT SOURCE: D5 = (row 4, col 3)
        try:
            subject_raw = str(df.iat[4, 3]).strip()
        except Exception:
            continue

        # Tourism fix: derive hint from sheet tab name
        hint = subject_hint_from_sheet(sheet_name)

        # Normalize/match subject
        subject_clean = match_subject(subject_raw, official_subjects, fallback_hint=hint)

        # Extract line number (look in D5, fallback to D4)
        top_cell = str(df.iat[3, 3]) if df.shape[0] > 3 and df.shape[1] > 3 else None
        line = parse_line(subject_raw, top_cell)
        if not line:
            # Maintain original behavior: skip malformed sheets
            continue

        # Find header row containing "NO" in column A
        try:
            header_rows = df.index[df.iloc[:, 0] == "NO"]
        except Exception:
            continue
        if len(header_rows) == 0:
            continue

        header_row = int(header_rows[0])

        # Extract student records
        data = df.iloc[header_row + 1:].dropna(subset=[0])
        data.columns = ["NO", "ADMNR", "NAME", "GENDER", "CLASS"]

        for _, row in data.iterrows():
            try:
                student_no = int(row.ADMNR)
            except Exception:
                continue

            master_records.append(
                {
                    "student_number": student_no,
                    "name": str(row.NAME).strip() if pd.notna(row.NAME) else "",
                    "gender": str(row.GENDER).strip() if pd.notna(row.GENDER) else "",
                    "class": str(row.CLASS).strip() if pd.notna(row.CLASS) else "",
                    "subject": subject_clean,
                    "line": line,
                    "teacher_raw": subject_raw,
                    "sheet": sheet_name,
                }
            )

    return master_records

# =========================
# MAIN
# =========================
if __name__ == "__main__":
    excel_path = Path(EXCEL_FILE)
    records = excel_to_master_json(excel_path, SUBJECTS_TXT)

    output_file = excel_path.with_name(excel_path.stem + "_Master_Subjects.json")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    print(f"✔ Created {output_file.name}")
    print(f"✔ Total records: {len(records)}")