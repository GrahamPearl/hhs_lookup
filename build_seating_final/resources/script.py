import json
import re
import pandas as pd

# File names
STUDENTS_JSON = "students.json"
FINALS_XLSX = "Finals.xlsx"
CONCESSIONS_TXT = "1. Concessions - English.txt"
OUTPUT_JSON = "students_updated.json"

# Load Exam Numbers from Excel
exam_df = pd.read_excel(FINALS_XLSX, engine="openpyxl", dtype=str)

exam_map = {
    str(row["ADMNO"]).strip(): str(row["ExamNo"]).strip()
    for _, row in exam_df.iterrows()
}

# Load concession admin numbers
with open(CONCESSIONS_TXT, "r", encoding="utf-8") as f:
    concessions = set(re.findall(r"\d+", f.read()))

# Load students JSON
with open(STUDENTS_JSON, "r", encoding="utf-8") as f:
    students = json.load(f)

exam_matches = 0
concession_matches = 0

# Update students
for student in students:
    admin_no = str(student.get("adminNo", "")).strip()

    # Add Exam Number
    if admin_no in exam_map:
        student["ExamNo"] = exam_map[admin_no]
        exam_matches += 1

    # Add Concession Flag
    if admin_no in concessions:
        student["Concession"] = "True"
        concession_matches += 1

# Save updated JSON
with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(students, f, indent=2, ensure_ascii=False)

print(f"Students processed: {len(students)}")
print(f"Exam numbers added: {exam_matches}")
print(f"Concessions added: {concession_matches}")
print(f"Output written to: {OUTPUT_JSON}")