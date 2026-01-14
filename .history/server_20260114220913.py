from flask import Flask, jsonify, request, send_from_directory
from pathlib import Path
import json
import uuid
import tempfile
import shutil
from datetime import datetime, timedelta

app = Flask(__name__, static_folder='web', static_url_path='/web')

DATA_DIR = Path('data')
USER_FILE = DATA_DIR / 'glossary_user.json'
IMAGES_DIR = DATA_DIR / 'images'
IMAGES_FILE = DATA_DIR / 'images.json'
EQUATIONS_FILE = DATA_DIR / 'equations.json'
BACKUPS_DIR = DATA_DIR / 'backups'
MAX_BACKUPS = 10
DATA_DIR.mkdir(exist_ok=True)
IMAGES_DIR.mkdir(exist_ok=True)
BACKUPS_DIR.mkdir(exist_ok=True)

def backup_file(source_path):
    """Create a timestamped backup of the source file and keep only MAX_BACKUPS recent ones."""
    if not source_path.exists():
        return
    try:
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        backup_name = f"{source_path.stem}_{timestamp}{source_path.suffix}"
        backup_path = BACKUPS_DIR / backup_name
        shutil.copy2(str(source_path), str(backup_path))
        # Clean up old backups (keep only MAX_BACKUPS)
        backups = sorted(BACKUPS_DIR.glob(f"{source_path.stem}_*{source_path.suffix}"))
        if len(backups) > MAX_BACKUPS:
            for old in backups[:-MAX_BACKUPS]:
                try:
                    old.unlink()
                except Exception:
                    pass
    except Exception as e:
        print(f"Warning: backup failed - {e}")


def atomic_write(path, content):
    """Write content to path atomically: write to temp file, then rename."""
    try:
        # Create temp file in same directory for atomic rename
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, encoding='utf-8', delete=False, suffix='.tmp') as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        # Atomic rename
        Path(tmp_path).replace(path)
    except Exception as e:
        # Clean up temp file if it exists
        if tmp_path and Path(tmp_path).exists():
            try:
                Path(tmp_path).unlink()
            except Exception:
                pass
        raise e


def load_items():
    if USER_FILE.exists():
        try:
            raw = json.loads(USER_FILE.read_text(encoding='utf-8') or '[]')
            # Migrate old schema where entries used a `type` field with values 'Terme' or 'Abréviation'
            migrated = []
            changed = False
            now = datetime.utcnow()
            # Use index to create artificial timestamps that preserve current order (oldest first)
            # Start from 30 days ago and increment by 1 hour per entry
            base_time = now - timedelta(days=30)
            
            # Check if we need to remigrate timestamps (multiple entries have same timestamp)
            needs_remigration = False
            if len(raw) >= 3:
                # Count how many unique timestamps exist in the data
                timestamps = [e.get('created_at', '') for e in raw if e.get('created_at')]
                unique_timestamps = set(timestamps)
                # If more than 50% of entries share the same timestamp, remigrate
                if timestamps and len(unique_timestamps) < len(timestamps) * 0.5:
                    needs_remigration = True
            
            for idx, it in enumerate(raw):
                # if already in new format (has 'term' and optional 'abbreviation'), keep
                if 'abbreviation' in it or 'type' not in it:
                    new = dict(it)
                    # Add or fix timestamps
                    if 'created_at' not in new or needs_remigration:
                        # Create artificial timestamp: older entries get earlier times
                        artificial_time = base_time + timedelta(hours=idx)
                        new['created_at'] = artificial_time.isoformat() + 'Z'
                        new['updated_at'] = new['created_at']
                        changed = True
                    elif 'updated_at' not in new:
                        new['updated_at'] = new.get('created_at')
                        changed = True
                    # Add tags field if missing
                    if 'tags' not in new:
                        new['tags'] = []
                        changed = True
                    migrated.append(new)
                    continue
                # migrate (handle old schema with 'type' field)
                new = dict(it)
                t = it.get('type')
                if t == 'Abréviation':
                    # original: term = short abbr, definition = expanded phrase/meaning
                    short = it.get('term')
                    expanded = it.get('definition')
                    # set term to expanded if available, keep definition as-is
                    new['term'] = expanded or short
                    new['abbreviation'] = short
                else:
                    # Treat as Terme (keep term/definition)
                    new['abbreviation'] = it.get('abbreviation') if it.get('abbreviation') else ''
                # remove legacy type marker
                if 'type' in new:
                    del new['type']
                # Add timestamps to migrated entries
                artificial_time = base_time + timedelta(hours=idx)
                new['created_at'] = artificial_time.isoformat() + 'Z'
                new['updated_at'] = new['created_at']
                # Add tags field if missing
                new['tags'] = new.get('tags', [])
                migrated.append(new)
                changed = True
            # If migration changed data, persist back
            if changed:
                try:
                    USER_FILE.write_text(json.dumps(migrated, ensure_ascii=False, indent=2), encoding='utf-8')
                except Exception:
                    pass
            return migrated
        except Exception:
            return []
    return []

def save_items(items):
    backup_file(USER_FILE)  # Backup before writing
    content = json.dumps(items, ensure_ascii=False, indent=2)
    atomic_write(USER_FILE, content)


def load_images():
    if IMAGES_FILE.exists():
        try:
            return json.loads(IMAGES_FILE.read_text(encoding='utf-8') or '[]')
        except Exception:
            return []
    return []


def save_images(images):
    backup_file(IMAGES_FILE)  # Backup before writing
    content = json.dumps(images, ensure_ascii=False, indent=2)
    atomic_write(IMAGES_FILE, content)


def load_equations():
    if EQUATIONS_FILE.exists():
        try:
            return json.loads(EQUATIONS_FILE.read_text(encoding='utf-8') or '[]')
        except Exception:
            return []
    return []


def save_equations(equations):
    backup_file(EQUATIONS_FILE)  # Backup before writing
    content = json.dumps(equations, ensure_ascii=False, indent=2)
    atomic_write(EQUATIONS_FILE, content)


@app.route('/')
def index():
    return send_from_directory('web', 'index.html')


@app.route('/api/terms', methods=['GET'])
def list_terms():
    items = load_items()
    return jsonify(items)


@app.route('/api/images', methods=['GET'])
def list_images():
    images = load_images()
    return jsonify(images)


@app.route('/api/images', methods=['POST'])
def upload_image():
    # Expect multipart/form-data with 'file' and 'title' (optional)
    if 'file' not in request.files:
        return jsonify({'error': 'no file uploaded'}), 400
    file = request.files['file']
    title = request.form.get('title', '').strip() or file.filename
    if file.filename == '':
        return jsonify({'error': 'no file selected'}), 400
    # allow common image types and pdf
    allowed = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf'}
    suffix = Path(file.filename).suffix.lower()
    if suffix not in allowed:
        return jsonify({'error': f'file type not allowed: {suffix}'}), 400
    # create unique filename
    new_name = f"{uuid.uuid4().hex}{suffix}"
    dest = IMAGES_DIR / new_name
    try:
        file.save(str(dest))
    except Exception as e:
        return jsonify({'error': 'could not save file', 'detail': str(e)}), 500
    images = load_images()
    meta = {
        'id': str(uuid.uuid4()),
        'title': title,
        'filename': new_name,
        'original': file.filename,
        'uploaded_at': __import__('datetime').datetime.utcnow().isoformat() + 'Z'
    }
    images.append(meta)
    save_images(images)
    return jsonify(meta), 201


@app.route('/images/<path:fn>')
def serve_image(fn):
    # serve uploaded images
    return send_from_directory(str(IMAGES_DIR), fn)


@app.route('/api/images/<image_id>', methods=['DELETE'])
def delete_image(image_id):
    images = load_images()
    found = None
    for it in images:
        if it.get('id') == image_id:
            found = it
            break
    if not found:
        return jsonify({'error': 'not found'}), 404
    # remove file if exists
    fn = found.get('filename')
    if fn:
        p = IMAGES_DIR / fn
        try:
            if p.exists():
                p.unlink()
        except Exception:
            pass
    # remove metadata
    new = [it for it in images if it.get('id') != image_id]
    save_images(new)
    return jsonify({'deleted': True})


@app.route('/api/terms', methods=['POST'])
def create_term():
    data = request.get_json(silent=True) or {}
    # New schema requires 'term' and 'definition'; 'abbreviation' is optional
    required = ['term', 'definition']
    if not all(k in data and isinstance(data[k], str) and data[k].strip() for k in required):
        return jsonify({'error': 'missing or invalid fields, required: term, definition'}), 400
    items = load_items()
    now = datetime.utcnow().isoformat() + 'Z'
    # Parse tags: if it's a string (comma-separated), split and trim; if already list, use as-is
    tags_input = data.get('tags', [])
    if isinstance(tags_input, str):
        tags = [t.strip() for t in tags_input.split(',') if t.strip()]
    elif isinstance(tags_input, list):
        tags = [t.strip() for t in tags_input if isinstance(t, str) and t.strip()]
    else:
        tags = []
    item = {
        'id': str(uuid.uuid4()),
        'term': data['term'].strip(),
        'definition': data['definition'].strip(),
        'abbreviation': data.get('abbreviation','').strip(),
        'tags': tags,
        'created_at': now,
        'updated_at': now
    }
    items.append(item)
    save_items(items)
    return jsonify(item), 201


@app.route('/api/terms/<term_id>', methods=['PUT'])
def update_term(term_id):
    data = request.get_json(silent=True) or {}
    items = load_items()
    for i, it in enumerate(items):
        if it.get('id') == term_id:
            it['term'] = data.get('term', it.get('term'))
            it['definition'] = data.get('definition', it.get('definition'))
            it['abbreviation'] = data.get('abbreviation', it.get('abbreviation', ''))
            # Parse tags: if it's a string (comma-separated), split and trim; if already list, use as-is
            if 'tags' in data:
                tags_input = data['tags']
                if isinstance(tags_input, str):
                    tags = [t.strip() for t in tags_input.split(',') if t.strip()]
                elif isinstance(tags_input, list):
                    tags = [t.strip() for t in tags_input if isinstance(t, str) and t.strip()]
                else:
                    tags = it.get('tags', [])
                it['tags'] = tags
            elif 'tags' not in it:
                it['tags'] = []
            it['updated_at'] = datetime.utcnow().isoformat() + 'Z'
            if 'created_at' not in it:
                it['created_at'] = it['updated_at']
            items[i] = it
            save_items(items)
            return jsonify(it)
    return jsonify({'error': 'not found'}), 404


@app.route('/api/terms/<term_id>', methods=['DELETE'])
def delete_term(term_id):
    items = load_items()
    new = [it for it in items if it.get('id') != term_id]
    if len(new) == len(items):
        return jsonify({'error': 'not found'}), 404
    save_items(new)
    return jsonify({'deleted': True})


# Equations endpoints
@app.route('/api/equations', methods=['GET'])
def list_equations():
    equations = load_equations()
    return jsonify(equations)


@app.route('/api/equations', methods=['POST'])
def create_equation():
    data = request.get_json(silent=True) or {}
    required = ['name', 'content']
    if not all(k in data and isinstance(data[k], str) and data[k].strip() for k in required):
        return jsonify({'error': 'missing or invalid fields, required: name, content'}), 400
    equations = load_equations()
    now = datetime.utcnow().isoformat() + 'Z'
    equation = {
        'id': str(uuid.uuid4()),
        'name': data['name'].strip(),
        'content': data['content'].strip(),
        'description': data.get('description', '').strip(),
        'created_at': now,
        'updated_at': now
    }
    equations.append(equation)
    save_equations(equations)
    return jsonify(equation), 201


@app.route('/api/equations/<eq_id>', methods=['PUT'])
def update_equation(eq_id):
    data = request.get_json(silent=True) or {}
    equations = load_equations()
    for i, eq in enumerate(equations):
        if eq.get('id') == eq_id:
            eq['name'] = data.get('name', eq.get('name'))
            eq['content'] = data.get('content', eq.get('content'))
            eq['description'] = data.get('description', eq.get('description', ''))
            eq['updated_at'] = datetime.utcnow().isoformat() + 'Z'
            equations[i] = eq
            save_equations(equations)
            return jsonify(eq)
    return jsonify({'error': 'not found'}), 404


@app.route('/api/equations/<eq_id>', methods=['DELETE'])
def delete_equation(eq_id):
    equations = load_equations()
    new = [eq for eq in equations if eq.get('id') != eq_id]
    if len(new) == len(equations):
        return jsonify({'error': 'not found'}), 404
    save_equations(new)
    return jsonify({'deleted': True})


@app.route('/web/<path:p>')
def static_files(p):
    return send_from_directory('web', p)


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
