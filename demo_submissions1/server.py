"""
Assessment Portal — Flask Backend v3
Changes: Class-aware student model, multi-extension support,
         clear submissions, /api/classes endpoint
Run: pip install flask flask-cors werkzeug
     python server.py
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import json, os, subprocess, time, re, shutil
from datetime import datetime
from werkzeug.utils import secure_filename
import threading
import uuid

JOBS = {}  # job_id → {status, progress, total, results, logs}

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = Flask(__name__, static_folder=".")
CORS(app)

# ── Paths ──────────────────────────────────────────────────────────────────
DATA_DIR         = "data"
STUDENTS_FILE    = os.path.join(DATA_DIR, "students.json")
ASSESSMENTS_META = os.path.join(DATA_DIR, "assessments.json")
ASSESSMENTS_DIR  = os.path.join(DATA_DIR, "assessments")

for d in [DATA_DIR, ASSESSMENTS_DIR]:
    os.makedirs(d, exist_ok=True)

# ── Config ─────────────────────────────────────────────────────────────────
TEACHER_EMAIL = os.getenv("TEACHER_EMAIL", "teacher@school.com").strip().lower()
LOCK_DURATION = int(os.getenv("LOCK_DURATION", "300"))
BLOCKED_EXTS  = {".docm", ".xlsm", ".pptm"}

# ── Assessment helpers ─────────────────────────────────────────────────────
def adir(aid):     return os.path.join(ASSESSMENTS_DIR, aid)
def ascript(aid):  return os.path.join(adir(aid), "script.py")
def alocks(aid):   return os.path.join(adir(aid), "locks.json")
def areports(aid): return os.path.join(adir(aid), "reports.json")
def asubs(aid):    return os.path.join(adir(aid), "submissions")

def ensure_adir(aid):
    os.makedirs(asubs(aid), exist_ok=True)

def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40]

# ── JSON helpers ───────────────────────────────────────────────────────────
def jload(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except:
        return default

def jsave(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

# ── Assessment meta helpers ────────────────────────────────────────────────
def load_assessments_meta():
    meta = jload(ASSESSMENTS_META, [])
    for a in meta:
        a.setdefault("active", True)
        a.setdefault("submission_type", "single_file")
        a.setdefault("allowed_extensions", [".docx"])
        a.setdefault("max_size_mb", 10)
        a.setdefault("instructions", "")
    return meta

def save_assessments_meta(meta):
    jsave(ASSESSMENTS_META, meta)

def get_assessment(aid):
    for a in load_assessments_meta():
        if a.get("id") == aid:
            return a
    return None

# ── Student helpers (v3: object model with class) ──────────────────────────
def load_students():
    """Load students. Backward-compatible with old plain string-array format."""
    raw    = jload(STUDENTS_FILE, [])
    result = []
    for item in raw:
        if isinstance(item, str):
            e = norm_email(item)
            if e:
                result.append({"email": e, "class": "Unassigned"})
        elif isinstance(item, dict):
            e = norm_email(item.get("email", ""))
            if e:
                result.append({
                    "email": e,
                    "class": str(item.get("class", "Unassigned")).strip() or "Unassigned"
                })
    seen, out = set(), []
    for s in result:
        if s["email"] not in seen:
            seen.add(s["email"])
            out.append(s)
    return out

def save_students(students):
    jsave(STUDENTS_FILE, students)

# ── Validation helpers ─────────────────────────────────────────────────────
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")

def norm_email(email: str) -> str:
    return (email or "").strip().lower()

def is_valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(norm_email(email)))

def ext_of(filename):
    _, ext = os.path.splitext(filename or "")
    return ext.lower().strip()

def file_size_bytes(fs):
    try:
        pos = fs.stream.tell()
        fs.stream.seek(0, os.SEEK_END)
        size = fs.stream.tell()
        fs.stream.seek(pos, os.SEEK_SET)
        return size
    except:
        return None

def validate_upload_file(assessment, fs):
    if not fs or not getattr(fs, "filename", ""):
        return False, "No file uploaded."
    allowed   = [str(e).lower() for e in (assessment.get("allowed_extensions") or [".docx"])]
    max_mb    = float(assessment.get("max_size_mb") or 10)
    max_bytes = int(max_mb * 1024 * 1024)
    ext = ext_of(fs.filename)
    if ext in BLOCKED_EXTS:
        return False, f"File type {ext} is blocked (macro-enabled files not allowed)."
    if ext not in allowed:
        return False, f"Invalid file type. Allowed: {', '.join(allowed)}"
    size = file_size_bytes(fs)
    if size is not None and size > max_bytes:
        return False, f"File too large. Max: {max_mb:g} MB"
    return True, ""

# ── Misc helpers ───────────────────────────────────────────────────────────
def now_iso():
    return datetime.now().isoformat()

def grade_of(pct):
    if pct >= 80: return "A"
    if pct >= 70: return "B"
    if pct >= 60: return "C"
    if pct >= 50: return "D"
    return "F"

def recalc(entry):
    tasks     = entry.get("report", {}).get("tasks", [])
    overrides = entry.get("overrides", {})
    adj = sum(
        (1 if overrides[str(t["id"])]["passed"] else 0)
        if str(t["id"]) in overrides else (1 if t["passed"] else 0)
        for t in tasks
    )
    total = len(tasks)
    entry["adjusted_score"] = adj
    entry["adjusted_grade"] = grade_of(100 * adj / total if total else 0)

# ═══════════════════════════════════════════════════════════════════════════
#  AUTH
# ═══════════════════════════════════════════════════════════════════════════
@app.route("/api/login", methods=["POST"])
def login():
    email = norm_email((request.json or {}).get("email", ""))
    if not email:
        return jsonify({"error": "Email required"}), 400
    if email == TEACHER_EMAIL:
        return jsonify({"role": "teacher", "email": email})
    students = load_students()
    student  = next((s for s in students if s["email"] == email), None)
    if student:
        return jsonify({"role": "student", "email": email,
                        "class": student.get("class", "Unassigned")})
    return jsonify({"error": "Email not recognised. Contact your teacher."}), 401

# ═══════════════════════════════════════════════════════════════════════════
#  STUDENTS
# ═══════════════════════════════════════════════════════════════════════════
@app.route("/api/upload-students", methods=["POST"])
def upload_students():
    """Accept plain emails (one per line) OR email,class format."""
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file"}), 400
    seen = {}
    for ln in f.read().decode("utf-8", errors="ignore").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        if "," in ln:
            parts = ln.split(",", 1)
            email = norm_email(parts[0])
            cls   = parts[1].strip() or "Unassigned"
        else:
            email = norm_email(ln)
            cls   = "Unassigned"
        if email and is_valid_email(email) and email not in seen:
            seen[email] = cls
    students = [{"email": e, "class": c} for e, c in seen.items()]
    save_students(students)
    return jsonify({"count": len(students), "students": students})

@app.route("/api/students")
def get_students():
    return jsonify(load_students())

@app.route("/api/students", methods=["POST"])
def add_student():
    body  = request.json or {}
    email = norm_email(body.get("email", ""))
    cls   = str(body.get("class", "Unassigned")).strip() or "Unassigned"
    if not email:
        return jsonify({"error": "Email required"}), 400
    if not is_valid_email(email):
        return jsonify({"error": "Invalid email format"}), 400
    students = load_students()
    if any(s["email"] == email for s in students):
        return jsonify({"error": "Duplicate email"}), 409
    students.append({"email": email, "class": cls})
    save_students(students)
    return jsonify({"message": "Added", "email": email, "class": cls,
                    "students": students})

@app.route("/api/students/<path:email>", methods=["DELETE"])
def delete_student(email):
    email    = norm_email(email)
    students = load_students()
    if not any(s["email"] == email for s in students):
        return jsonify({"error": "Not found"}), 404
    save_students([s for s in students if s["email"] != email])
    return jsonify({"message": "Deleted", "email": email})

@app.route("/api/students/<path:email>", methods=["PUT"])
def edit_student(email):
    old       = norm_email(email)
    body      = request.json or {}
    new_email = norm_email(body.get("email", old))
    new_cls   = str(body.get("class", "")).strip()
    students  = load_students()
    idx = next((i for i, s in enumerate(students) if s["email"] == old), None)
    if idx is None:
        return jsonify({"error": "Not found"}), 404
    if new_email != old and any(s["email"] == new_email for s in students):
        return jsonify({"error": "Duplicate email"}), 409
    if not is_valid_email(new_email):
        return jsonify({"error": "Invalid email format"}), 400
    students[idx]["email"] = new_email
    if new_cls:
        students[idx]["class"] = new_cls
    save_students(students)
    return jsonify({"message": "Updated", "old": old,
                    "email": new_email, "class": students[idx]["class"],
                    "students": students})

@app.route("/api/classes")
def list_classes():
    classes = sorted(set(s.get("class", "Unassigned") for s in load_students()))
    return jsonify(classes)

# ═══════════════════════════════════════════════════════════════════════════
#  ASSESSMENTS
# ═══════════════════════════════════════════════════════════════════════════
@app.route("/api/assessments", methods=["GET"])
def list_assessments():
    return jsonify(load_assessments_meta())

@app.route("/api/assessments/<aid>", methods=["GET"])
def get_assessment_route(aid):
    a = get_assessment(aid)
    return jsonify(a) if a else (jsonify({"error": "Not found"}), 404)

@app.route("/api/assessments", methods=["POST"])
def create_assessment():
    name = (request.json or {}).get("name", "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    aid   = f"{slugify(name)}_{int(time.time())}"
    ensure_adir(aid)
    entry = {"id": aid, "name": name, "created_at": now_iso(),
             "active": True, "submission_type": "single_file",
             "allowed_extensions": [".docx"], "max_size_mb": 10, "instructions": ""}
    meta  = load_assessments_meta()
    meta.append(entry)
    save_assessments_meta(meta)
    return jsonify(entry)

@app.route("/api/assessments/<aid>", methods=["PUT"])
def update_assessment(aid):
    body    = request.json or {}
    meta    = load_assessments_meta()
    updated = None
    for a in meta:
        if a.get("id") == aid:
            if "active" in body:
                a["active"] = bool(body["active"])
            if "submission_type" in body:
                a["submission_type"] = str(body["submission_type"] or "single_file")
            if "allowed_extensions" in body:
                a["allowed_extensions"] = [str(e).lower() for e in (body["allowed_extensions"] or [])]
            if "max_size_mb" in body:
                try:    a["max_size_mb"] = float(body["max_size_mb"])
                except: return jsonify({"error": "max_size_mb must be numeric"}), 400
            if "instructions" in body:
                a["instructions"] = str(body["instructions"] or "")
            updated = a
            break
    if not updated:
        return jsonify({"error": "Not found"}), 404
    save_assessments_meta(meta)
    return jsonify(updated)

@app.route("/api/assessments/<aid>", methods=["DELETE"])
def delete_assessment(aid):
    meta = [a for a in load_assessments_meta() if a["id"] != aid]
    save_assessments_meta(meta)
    return jsonify({"deleted": aid})

# ═══════════════════════════════════════════════════════════════════════════
#  PER-ASSESSMENT: SCRIPT
# ═══════════════════════════════════════════════════════════════════════════
@app.route("/api/a/<aid>/upload-script", methods=["POST"])
def upload_script(aid):
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file"}), 400
    if not f.filename.endswith(".py"):
        return jsonify({"error": "Only .py files accepted"}), 400
    ensure_adir(aid)
    f.save(ascript(aid))
    return jsonify({"message": f"Script '{f.filename}' uploaded"})

@app.route("/api/a/<aid>/script-status")
def script_status(aid):
    path = ascript(aid)
    ex   = os.path.exists(path)
    mt   = os.path.getmtime(path) if ex else None
    return jsonify({"uploaded": ex,
                    "uploaded_at": datetime.fromtimestamp(mt).isoformat() if mt else None})

# ═══════════════════════════════════════════════════════════════════════════
#  PER-ASSESSMENT: SUBMISSIONS
# ═══════════════════════════════════════════════════════════════════════════
@app.route("/api/a/<aid>/submit", methods=["POST"])
def submit(aid):
    email = norm_email(request.form.get("email", ""))
    f     = request.files.get("file")
    if not email or not f:
        return jsonify({"error": "Missing email or file"}), 400
    assessment = get_assessment(aid)
    if not assessment:
        return jsonify({"error": "Assessment not found"}), 404
    if not assessment.get("active", True):
        return jsonify({"error": "Assessment is closed."}), 403
    ok, err = validate_upload_file(assessment, f)
    if not ok:
        return jsonify({"error": err}), 400
    ensure_adir(aid)
    locks = jload(alocks(aid), {})
    now   = time.time()
    if email in locks:
        elapsed = now - locks[email]["timestamp"]
        if elapsed < LOCK_DURATION:
            rem = int(LOCK_DURATION - elapsed)
            return jsonify({"error": f"Locked — try again in {rem}s.",
                            "locked": True, "remaining": rem}), 403
    ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder   = f"{email}_{ts}"
    fpath    = os.path.join(asubs(aid), folder)
    os.makedirs(fpath, exist_ok=True)
    filename = secure_filename(f.filename)
    f.save(os.path.join(fpath, filename))
    versions = locks.get(email, {}).get("versions", [])
    versions.append({"folder": folder, "filename": filename, "submitted_at": now_iso()})
    locks[email] = {"timestamp": now, "current_folder": folder,
                    "current_filename": filename, "submitted_at": now_iso(),
                    "versions": versions, "unlocked_by_teacher": False}
    jsave(alocks(aid), locks)
    return jsonify({"message": "Submission received", "version": len(versions)})

@app.route("/api/a/<aid>/lock-status/<path:email>")
def lock_status(aid, email):
    email = norm_email(email)
    locks = jload(alocks(aid), {})
    lk    = locks.get(email, {})
    if lk:
        elapsed = time.time() - lk["timestamp"]
        if elapsed < LOCK_DURATION:
            return jsonify({"locked": True, "remaining": int(LOCK_DURATION - elapsed),
                            "filename": lk.get("current_filename"),
                            "submitted_at": lk.get("submitted_at"),
                            "version_count": len(lk.get("versions", []))})
    return jsonify({"locked": False, "version_count": len(lk.get("versions", []))})

@app.route("/api/a/<aid>/unlock/<path:email>", methods=["POST"])
def unlock(aid, email):
    email = norm_email(email)
    locks = jload(alocks(aid), {})
    if email not in locks:
        return jsonify({"error": "No submission found"}), 404
    locks[email]["timestamp"]           = 0
    locks[email]["unlocked_by_teacher"] = True
    locks[email]["unlocked_at"]         = now_iso()
    jsave(alocks(aid), locks)
    return jsonify({"message": f"Unlocked {email}"})

@app.route("/api/a/<aid>/versions/<path:email>")
def versions(aid, email):
    lk = jload(alocks(aid), {}).get(norm_email(email), {})
    return jsonify({"versions": lk.get("versions", []), "current": lk.get("current_folder")})

@app.route("/api/a/<aid>/clear/<path:email>", methods=["DELETE"])
def clear_submissions(aid, email):
    email = norm_email(email)
    locks = jload(alocks(aid), {})
    if email not in locks:
        return jsonify({"error": "No submission found"}), 404
    for v in locks[email].get("versions", []):
        fp = os.path.join(asubs(aid), v["folder"])
        if os.path.exists(fp):
            shutil.rmtree(fp, ignore_errors=True)
    del locks[email]
    jsave(alocks(aid), locks)
    reports = jload(areports(aid), {})
    reports.pop(email, None)
    jsave(areports(aid), reports)
    return jsonify({"message": f"All submissions cleared for {email}"})

# ═══════════════════════════════════════════════════════════════════════════
#  PER-ASSESSMENT: MARKING
# ═══════════════════════════════════════════════════════════════════════════
def run_marking_job(job_id, aid, target_email=None):
    script = ascript(aid)
    locks  = jload(alocks(aid), {})
    reports = jload(areports(aid), {})

    targets = [target_email] if target_email else list(locks.keys())
    total   = len(targets)

    JOBS[job_id].update({
        "status": "running",
        "progress": 0,
        "total": total,
        "logs": []
    })

    for i, email in enumerate(targets, start=1):
        try:
            if email not in locks:
                JOBS[job_id]["logs"].append(f"{email}: no submission")
                continue

            folder = os.path.join(asubs(aid), locks[email]["current_folder"])

            proc = subprocess.run(
                ["python", script, folder, email],
                capture_output=True, text=True, timeout=60
            )

            try:
                report = json.loads(proc.stdout.strip())
            except:
                report = {"error": proc.stderr.strip() or "Invalid JSON"}

            entry = {
                "status": "success",
                "report": report,
                "marked_at": now_iso(),
                "overrides": {}
            }

            recalc(entry)
            reports[email] = entry

            JOBS[job_id]["logs"].append(f"{email}: done")

        except subprocess.TimeoutExpired:
            JOBS[job_id]["logs"].append(f"{email}: timeout")
        except Exception as e:
            JOBS[job_id]["logs"].append(f"{email}: error {str(e)}")

        JOBS[job_id]["progress"] = i

    jsave(areports(aid), reports)

    JOBS[job_id]["status"] = "completed"

@app.route("/api/a/<aid>/run-marking", methods=["POST"])
def start_marking(aid):
    script = ascript(aid)
    if not os.path.exists(script):
        return jsonify({"error": "No script uploaded"}), 400

    body = request.json or {}
    email = body.get("email")

    job_id = str(uuid.uuid4())

    JOBS[job_id] = {
        "status": "queued",
        "progress": 0,
        "total": 0,
        "logs": []
    }

    thread = threading.Thread(
        target=run_marking_job,
        args=(job_id, aid, email),
        daemon=True
    )
    thread.start()

    return jsonify({"job_id": job_id})

@app.route("/api/job-status/<job_id>")
def job_status(job_id):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404

    return jsonify(job)

##@app.route("/api/a/<aid>/run-marking", methods=["POST"])
##def run_marking(aid):
    script = ascript(aid)
    if not os.path.exists(script):
        return jsonify({"error": "No marking script uploaded"}), 400
    body    = request.json or {}
    target  = body.get("email")
    locks   = jload(alocks(aid), {})
    reports = jload(areports(aid), {})
    targets = [target] if target else list(locks.keys())
    results = {}
    for email in targets:
        if email not in locks:
            results[email] = {"status": "no_submission"}; continue
        folder = os.path.join(asubs(aid), locks[email]["current_folder"])
        try:
            proc = subprocess.run(["python", script, folder, email],
                                  capture_output=True, text=True, timeout=60)
            try:
                report = json.loads(proc.stdout.strip())
            except json.JSONDecodeError:
                report = {"raw_output": proc.stdout.strip(),
                          "error": proc.stderr.strip() or "Script did not return valid JSON"}
            entry = {"status": "success", "report": report,
                     "marked_at": now_iso(), "overrides": {}}
            recalc(entry)
            results[email] = entry
        except subprocess.TimeoutExpired:
            results[email] = {"status": "timeout", "report": {"error": "Script timed out (>60s)"}}
        except Exception as e:
            results[email] = {"status": "error", "report": {"error": str(e)}}
    reports.update(results)
    jsave(areports(aid), reports)
    return jsonify(results)
# ═══════════════════════════════════════════════════════════════════════════
#  PER-ASSESSMENT: OVERRIDES
# ═══════════════════════════════════════════════════════════════════════════
@app.route("/api/a/<aid>/override/<path:email>", methods=["POST"])
def override_task(aid, email):
    email   = norm_email(email)
    body    = request.json or {}
    task_id = str(body.get("task_id"))
    passed  = bool(body.get("passed"))
    note    = str(body.get("note", "")).strip()
    reports = jload(areports(aid), {})
    entry   = reports.get(email)
    if not entry or entry.get("status") != "success":
        return jsonify({"error": "No marked report found"}), 404
    original = next((t["passed"] for t in entry["report"].get("tasks", [])
                     if str(t["id"]) == task_id), None)
    entry.setdefault("overrides", {})[task_id] = {
        "passed": passed, "original": original, "note": note, "at": now_iso()}
    recalc(entry)
    reports[email] = entry
    jsave(areports(aid), reports)
    return jsonify(entry)

@app.route("/api/a/<aid>/override/<path:email>/<task_id>", methods=["DELETE"])
def reset_override(aid, email, task_id):
    email   = norm_email(email)
    reports = jload(areports(aid), {})
    entry   = reports.get(email)
    if not entry:
        return jsonify({"error": "Not found"}), 404
    entry.get("overrides", {}).pop(str(task_id), None)
    recalc(entry)
    reports[email] = entry
    jsave(areports(aid), reports)
    return jsonify(entry)

@app.route("/api/a/<aid>/analytics")
def assessment_analytics(aid):
    reports = jload(areports(aid), {})
    students = load_students()

    grades = {"A": 0, "B": 0, "C": 0, "D": 0, "F": 0}
    tasks = {}
    trend = []

    total_scores = []

    for email, entry in reports.items():
        if entry.get("status") != "success":
            continue

        score = entry.get("adjusted_score")
        total = entry.get("report", {}).get("total", 0)

        if total:
            pct = 100 * score / total
            total_scores.append(pct)

        # grade count
        grade = entry.get("adjusted_grade")
        if grade in grades:
            grades[grade] += 1

        # tasks
        for t in entry.get("report", {}).get("tasks", []):
            tid = str(t["id"])
            if tid not in tasks:
                tasks[tid] = {
                    "name": t["name"],
                    "total": 0,
                    "passed": 0
                }

            tasks[tid]["total"] += 1
            if t["passed"]:
                tasks[tid]["passed"] += 1

    # calculate pass rates
    for tid in tasks:
        t = tasks[tid]
        t["pass_rate"] = round(100 * t["passed"] / t["total"]) if t["total"] else 0

    # simple trend (1-point trend just for now)
    avg = round(sum(total_scores) / len(total_scores), 1) if total_scores else 0
    trend.append({
        "assessment": aid,
        "average": avg
    })
    
    # --- INSIGHTS ---
    at_risk = []
    top_performers = []

    scores_by_student = []

    for email, entry in reports.items():
        if entry.get("status") != "success":
            continue

        score = entry.get("adjusted_score")
        total = entry.get("report", {}).get("total", 0)

        if total:
            pct = 100 * score / total
            scores_by_student.append((email, pct))

    # sort
    scores_by_student.sort(key=lambda x: x[1])

    # bottom 3 (at risk)
    at_risk = [{"email": s[0]} for s in scores_by_student[:3]]

    # top 3
    top_performers = [{"email": s[0]} for s in scores_by_student[-3:]]

    # variance
    values = [s[1] for s in scores_by_student]
    variance = 0
    if values:
        mean = sum(values) / len(values)
        variance = round(sum((x - mean) ** 2 for x in values) / len(values), 2)

    # hardest & easiest task
    hardest_task = None
    easiest_task = None

    if tasks:
        sorted_tasks = sorted(tasks.values(), key=lambda t: t["pass_rate"])
        hardest_task = sorted_tasks[0]
        easiest_task = sorted_tasks[-1]    

    return jsonify({    
        "grades": grades,
        "tasks": tasks,
        "trend": trend,
        "insights": {
            "at_risk": at_risk,
            "top_performers": top_performers,
            "hardest_task": hardest_task,
            "easiest_task": easiest_task,
            "variance": variance
        }
    })

    
@app.route("/api/analytics/overall")
def overall_analytics():
    meta = load_assessments_meta()
    all_scores = []
    student_perf = {}

    for a in meta:
        reports = jload(areports(a["id"]), {})
        for email, r in reports.items():
            if r.get("status") != "success":
                continue

            total = r["report"].get("total",1)
            score = r.get("adjusted_score",0)
            pct = 100 * score / total if total else 0

            all_scores.append(pct)
            student_perf.setdefault(email, []).append(pct)
    
    trend = []

    for a in meta:
        reports = jload(areports(a["id"]), {})
        scores = []

        for r in reports.values():
            if r.get("status") != "success":
                continue
            total = r["report"].get("total",1)
            score = r.get("adjusted_score",0)
            scores.append(100*score/total if total else 0)

        if scores:
            trend.append({
                "assessment": a["name"],
                "average": round(sum(scores)/len(scores),1)
            })

    avg = sum(all_scores)/len(all_scores) if all_scores else 0

    return jsonify({
        "average": round(avg,1),
        "trend": trend,
        "students": {
            k: round(sum(v)/len(v),1) for k,v in student_perf.items()
        }
    })
    
@app.route("/api/students/export")
def export_students():
    students = load_students()
    lines = ["email,class"]
    for s in students:
        lines.append(f"{s['email']},{s['class']}")
    return "\n".join(lines), 200, {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=students.csv"
    }

# ═══════════════════════════════════════════════════════════════════════════
#  PER-ASSESSMENT: REPORTS & SUMMARY
# ═══════════════════════════════════════════════════════════════════════════
@app.route("/api/a/<aid>/report/<path:email>")
def get_report(aid, email):
    reports = jload(areports(aid), {})
    entry   = reports.get(norm_email(email))
    return jsonify(entry if entry else {"status": "pending", "message": "No report yet"})

@app.route("/api/a/<aid>/summary")
def summary(aid):
    students = load_students()
    locks    = jload(alocks(aid), {})
    reports  = jload(areports(aid), {})
    now      = time.time()
    out = []
    for student in students:
        email = student["email"]
        lk    = locks.get(email, {})
        rpt   = reports.get(email, {})
        locked = bool(lk) and (now - lk.get("timestamp", 0)) < LOCK_DURATION
        out.append({
            "email":               email,
            "class":               student.get("class", "Unassigned"),
            "submitted":           bool(lk),
            "locked":              locked,
            "unlocked_by_teacher": lk.get("unlocked_by_teacher", False),
            "submitted_at":        lk.get("submitted_at"),
            "filename":            lk.get("current_filename"),
            "version_count":       len(lk.get("versions", [])),
            "marking_status":      rpt.get("status"),
            "report":              rpt.get("report"),
            "overrides":           rpt.get("overrides", {}),
            "adjusted_score":      rpt.get("adjusted_score"),
            "adjusted_grade":      rpt.get("adjusted_grade"),
            "marked_at":           rpt.get("marked_at"),
        })
    return jsonify(out)

# ── Serve SPA ──────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory(".", "app.html")

if __name__ == "__main__":
    print("=" * 55)
    print("  Assessment Portal v3")
    print(f"  http://localhost:5000")
    print(f"  Teacher login : {TEACHER_EMAIL}")
    print(f"  Lock duration : {LOCK_DURATION // 60} minutes")
    print("=" * 55)
    app.run(debug=True, port=5000, host="0.0.0.0")
