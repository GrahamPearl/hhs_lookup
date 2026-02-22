# extract.py  — Excel → Master JSON (final version with Mathematics + Tourism fixes)

import json
import re
import difflib
from pathlib import Path
import pandas as pd

# =========================
# CONFIGURATION
# =========================
SCRIPT_DIR = Path(__file__).resolve().parent

# Your workbook (Grade 10, Grade 11, etc.)
EXCEL_FILE = SCRIPT_DIR / "Grade12.xlsx"

# Official subject list (one per line)
SUBJECTS_TXT = SCRIPT_DIR / "list_of_subjects.txt"

# =========================
# SUBJECT NORMALIZATION
# =========================

ABBR = {
    "ENGHL": "English Home Language",
    "EGD": "Engineering Graphics and Design",
    "LS": "Life Science",
    "DRAMA": "Dramatic Arts",
    "IT": "Information Technology",
    "MATH": "Mathematics",
    "MATHS": "Mathematics",
    "MATHEMATICS": "Mathematics",
    "MATHEMATICAL LITERACY": "Mathematical Literacy",
    "MATH LIT": "Mathematical Literacy",
    "TOURISM": "Tourism",
    "VISUAL ARTS": "Visual Arts",
    "ENGLISH HOME LANGUAGE": "English Home Language",
    "LIFE SCIENCE": "Life Science",
    "LIFE SCIENCES": "Life Science",
}

MATH_PREFIXES = {"M", "MA", "MAT", "MATH", "MATHS", "MATHEMATICS"}

TEACHER_PREFIX_RE = re.compile(r"^\s*(MR\.|MRS\.|MR |MRS |MSS |MS |MISS )\s*", flags=re.I)
GRADE_SUFFIX_RE = re.compile(r"\s*\(Gr\s*\d+\)\s*$", flags=re.I)


def remove_grade_suffix(s: str) -> str:
    if not s:
        return ""
    return GRADE_SUFFIX_RE.sub("", s).strip()

def clean_teacher_prefix(s: str) -> str:
    if not s:
        return ""
    return TEACHER_PREFIX_RE.sub("", str(s)).strip()


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().upper())

def load_subject_list(path: Path) -> list[str]:
    subjects = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if s:
                subjects.append(s)
    return subjects

def trim_trailing_grade(raw: str) -> str:
    if not raw:
        return ""
    return re.sub(r"\s*\(\s*Gr\s*\d+\s*\)\s*$", "", raw, flags=re.I).strip()

def clean_raw_subject(raw: str) -> str:
    if not raw:
        return ""
    s = trim_trailing_grade(raw)
    s = re.sub(r"^\s*Group:\s*", "", s, flags=re.I)
    s = re.sub(r"\bLINE\s*[:=]?\s*\d+\b", "", s, flags=re.I)
    s = re.sub(r"\b(10|11|12)\.?\d*\b", "", s)
    s = re.sub(r"\b([A-Z][a-z]+)\b$", "", s).strip()
    s = re.sub(r"\(.*?Gr\s*\d+.*?\)", "", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def subject_hint_from_sheet(sheet_name: str) -> str:
    if not sheet_name:
        return ""
    left = sheet_name.split(" - ")[0].strip()
    return trim_trailing_grade(left)

# ============================================================
#  WE FORCE MATHEMATICS when subject is truncated (Ma, M, Mat)
# ============================================================
def force_mathematics_if_needed(cleaned_up: str, official_subjects: list[str]) -> str | None:
    if cleaned_up in MATH_PREFIXES or any(cleaned_up.startswith(p) for p in MATH_PREFIXES):
        for s in official_subjects:
            if _norm(s) == "MATHEMATICS":
                return s
    return None

# ============================================================
# MAIN SUBJECT MATCHING
# ============================================================
def match_subject(raw_subject: str, official_subjects: list[str], *, fallback_hint: str = "") -> str:
    cleaned = clean_raw_subject(raw_subject)
    cleaned_up = _norm(cleaned)
    offic_norm = { _norm(s): s for s in official_subjects }

    # 0) Sheet-name fallback (important for Tourism)
    if fallback_hint:
        fh = _norm(fallback_hint)
        if fh in offic_norm:
            return offic_norm[fh]

    # 1) — HARD MATHEMATICS OVERRIDE —
    math_hit = force_mathematics_if_needed(cleaned_up, official_subjects)
    if math_hit:
        return math_hit

    # 2) Direct match
    if cleaned_up in offic_norm:
        return offic_norm[cleaned_up]

    # 3) Abbreviation match
    if cleaned_up in ABBR:
        alias = ABBR[cleaned_up]
        alias_norm = _norm(alias)
        return offic_norm.get(alias_norm, alias)

    # 4) Contains check
    for s in official_subjects:
        if _norm(s) in cleaned_up:
            return s

    # 5) Startswith check
    if cleaned_up:
        first = cleaned_up.split()[0]
        for s in official_subjects:
            if _norm(s).startswith(first):
                return s

    # 6) Fuzzy match
    if cleaned_up:
        candidates = list(offic_norm.keys())
        best = difflib.get_close_matches(cleaned_up, candidates, n=1, cutoff=0.80)
        if best:
            return offic_norm[best[0]]

    # 7) Fallback
    return (cleaned or fallback_hint).title()

def parse_line(*raw_candidates: str) -> str | None:
    for raw in raw_candidates:
        if not raw:
            continue
        m = re.search(r"\bLINE\s*[:=]?\s*(\d{1,2})\b", str(raw), flags=re.I)
        if m:
            return m.group(1)
    return None


def extract_line_number(text):
    match = re.search(r"\d+", text)
    return int(match.group()) if match else None


# =========================
# EXTRACTION LOGIC
# =========================
def excel_to_master_json(excel_path: Path, subjects_txt: Path) -> list[dict]:
    print("Looking for:", excel_path)
    print("Exists:", excel_path.exists())

    official_subjects = load_subject_list(subjects_txt)
    xls = pd.ExcelFile(excel_path, engine="openpyxl")

    master_records = []

    for sheet_name in xls.sheet_names:
        df = pd.read_excel(xls, sheet_name=sheet_name, header=None, engine="openpyxl")

        # SUBJECT COMES FROM D5
        try:
            subject_raw = str(df.iat[4, 3]).strip()
            subject_raw = trim_trailing_grade(subject_raw)
            subject_raw = GRADE_SUFFIX_RE.sub("", subject_raw)       
        except Exception:
            continue
        
        try:
            subject_line = str(df.iat[3, 3]).strip()
            subject_line = extract_line_number(subject_line)
                   
        except Exception:
            continue
        
        try:
            teacher_cell = df.iat[5, 3] if df.shape[0] > 5 and df.shape[1] > 3 else None
            teacher_raw = clean_teacher_prefix(str(teacher_cell).strip()) if pd.notna(teacher_cell) else ""
        except Exception:
            teacher_raw = ""

        # Tourism fix: derive hint from sheet tab name
        # hint = subject_hint_from_sheet(sheet_name)

        # Normalise/match subject
        # subject_clean = match_subject(subject_raw, official_subjects, fallback_hint=hint)
        
        print(subject_raw)

        # Extract line from subject_raw or D4
        top_cell = str(df.iat[3, 3]) if df.shape[0] > 3 else None
        line = subject_line

        header_row = 9 
        data = df.iloc[header_row + 1 :].dropna(subset=[0])
        data.columns = ["NO", "ADMNR", "NAME", "GENDER", "CLASS"]

        for _, row in data.iterrows():
            student_no = int(row.ADMNR)
            
            master_records.append({
                "student_number": student_no,
                "name": str(row.NAME).strip() if pd.notna(row.NAME) else "",
                "gender": str(row.GENDER).strip() if pd.notna(row.GENDER) else "",
                "class": str(row.CLASS).strip() if pd.notna(row.CLASS) else "",
                "subject": subject_raw,       # ← NOW GUARANTEED CORRECT EVERY TIME
                "line": line,
                "teacher": teacher_raw,     # keep for auditing
                #"sheet": sheet_name,
            })
    
    print( int( len(master_records)) )
    
    return master_records

# =========================
# MAIN
# =========================
if __name__ == "__main__":
    excel_path = Path(EXCEL_FILE)
    records = excel_to_master_json(excel_path, SUBJECTS_TXT)

    output_file = excel_path.with_name("Subjects-"+excel_path.stem + ".json")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    print(f"✔ Created {output_file.name}")
    print(f"✔ Total records: {len(records)}")