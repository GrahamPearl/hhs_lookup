# extract.py  — Excel → Master JSON (with Tkinter GUI)

import json
import re
import difflib
from pathlib import Path
import pandas as pd
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext
import threading

# =========================
# CONFIGURATION
# =========================
SCRIPT_DIR = Path(__file__).resolve().parent

# Default paths (can be overridden via GUI)
DEFAULT_EXCEL = SCRIPT_DIR / "Grade12.xlsx"
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
    if not path.exists():
        return subjects
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

def force_mathematics_if_needed(cleaned_up: str, official_subjects: list[str]) -> str | None:
    if cleaned_up in MATH_PREFIXES or any(cleaned_up.startswith(p) for p in MATH_PREFIXES):
        for s in official_subjects:
            if _norm(s) == "MATHEMATICS":
                return s
    return None

def extract_line_number(text):
    match = re.search(r"\d+", text)
    return int(match.group()) if match else None

# =========================
# EXTRACTION LOGIC
# =========================
def excel_to_master_json(excel_path: Path, subjects_txt: Path, log_func=print) -> list[dict]:
    log_func(f"Looking for: {excel_path}")
    log_func(f"Exists: {excel_path.exists()}")

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
        
        log_func(f"Processing Sheet: {sheet_name} -> Subject: {subject_raw}")

        top_cell = str(df.iat[3, 3]) if df.shape[0] > 3 else None
        line = subject_line

        header_row = 8 
        data = df.iloc[header_row + 1 :].dropna(subset=[0])
        data.columns = ["NO", "ADMNR", "NAME", "GENDER", "CLASS"]

        for _, row in data.iterrows():
            try:
                student_no = int(row.ADMNR)
            except ValueError:
                continue
            
            master_records.append({
                "student_number": student_no,
                "name": str(row.NAME).strip() if pd.notna(row.NAME) else "",
                "gender": str(row.GENDER).strip() if pd.notna(row.GENDER) else "",
                "class": str(row.CLASS).strip() if pd.notna(row.CLASS) else "",
                "subject": subject_raw,
                "line": line,
                "teacher": teacher_raw,
            })
    
    log_func(f"Total records found: {len(master_records)}")
    return master_records

# =========================
# GUI APPLICATION
# =========================
class AppGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Excel to Master JSON Extractor")
        self.root.geometry("650x500")

        # Directory Selection Frame
        dir_frame = tk.LabelFrame(root, text=" Excel File Directory ", padx=10, pady=10)
        dir_frame.pack(fill="x", padx=15, pady=10)

        self.dir_path_var = tk.StringVar(value=str(SCRIPT_DIR))
        
        self.dir_entry = tk.Entry(dir_frame, textvariable=self.dir_path_var, width=55)
        self.dir_entry.pack(side="left", padx=(0, 10))

        browse_btn = tk.Button(dir_frame, text="Browse Folder", command=self.browse_folder)
        browse_btn.pack(side="left")

        # File Selection Frame
        file_frame = tk.LabelFrame(root, text=" Excel File Name ", padx=10, pady=10)
        file_frame.pack(fill="x", padx=15, pady=5)

        self.file_name_var = tk.StringVar(value="Grade12.xlsx")
        self.file_entry = tk.Entry(file_frame, textvariable=self.file_name_var, width=55)
        self.file_entry.pack(side="left", padx=(0, 10))

        # Run Button
        self.run_btn = tk.Button(root, text="Run Extraction", bg="#4CAF50", fg="white", font=("Arial", 11, "bold"), command=self.start_extraction_thread)
        self.run_btn.pack(pady=10)

        # Log/Console Output Box
        log_frame = tk.LabelFrame(root, text=" Execution Log ", padx=5, pady=5)
        log_frame.pack(fill="both", expand=True, padx=15, pady=(0, 15))

        self.log_box = scrolledtext.ScrolledText(log_frame, state="disabled", height=12, font=("Consolas", 9))
        self.log_box.pack(fill="both", expand=True)

    def log(self, message):
        self.log_box.config(state="normal")
        self.log_box.insert(tk.END, message + "\n")
        self.log_box.see(tk.END)
        self.log_box.config(state="disabled")

    def browse_folder(self):
        folder_selected = filedialog.askdirectory(initialdir=self.dir_path_var.get())
        if folder_selected:
            self.dir_path_var.set(folder_selected)

    def start_extraction_thread(self):
        # Run in a separate thread so the GUI doesn't freeze
        self.run_btn.config(state="disabled")
        threading.Thread(target=self.run_extraction, daemon=True).start()

    def run_extraction(self):
        try:
            directory = Path(self.dir_path_var.get())
            filename = self.file_name_var.get().strip()
            excel_path = directory / filename

            if not excel_path.exists():
                messagebox.showerror("Error", f"Could not find file:\n{excel_path}")
                self.run_btn.config(state="normal")
                return

            self.log(f"--- Starting Extraction ---")
            records = excel_to_master_json(excel_path, SUBJECTS_TXT, log_func=self.log)

            output_file = excel_path.with_name("Subjects-" + excel_path.stem + ".json")
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(records, f, indent=2, ensure_ascii=False)

            self.log(f"✔ Created successfully: {output_file.name}")
            self.log(f"✔ Total records saved: {len(records)}")
            messagebox.showinfo("Success", f"JSON generated successfully!\nSaved to:\n{output_file}")
        
        except Exception as e:
            messagebox.showerror("An Error Occurred", str(e))
            self.log(f"ERROR: {str(e)}")
        
        finally:
            self.run_btn.config(state="normal")

if __name__ == "__main__":
    root = tk.Tk()
    app = AppGUI(root)
    root.mainloop()