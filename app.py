import os
import json
import time
import requests
import urllib.parse
from datetime import datetime, timedelta, timezone
from functools import wraps
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from flask_bcrypt import Bcrypt
from dotenv import load_dotenv

load_dotenv()


def get_database_url():
    database_url = os.getenv('DATABASE_URL', 'sqlite:///pomodoro.db').strip()
    if database_url.startswith('postgres://'):
        return database_url.replace('postgres://', 'postgresql+psycopg://', 1)
    if database_url.startswith('postgresql://'):
        return database_url.replace('postgresql://', 'postgresql+psycopg://', 1)
    return database_url


app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')
app.config['SQLALCHEMY_DATABASE_URI'] = get_database_url()
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
if app.config['SQLALCHEMY_DATABASE_URI'].startswith('postgresql'):
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {'pool_pre_ping': True}

db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

SPOTIFY_CLIENT_ID = os.getenv('SPOTIFY_CLIENT_ID', '')
SPOTIFY_CLIENT_SECRET = os.getenv('SPOTIFY_CLIENT_SECRET', '')
SPOTIFY_REDIRECT_URI = os.getenv('SPOTIFY_REDIRECT_URI', 'http://localhost:5000/callback')
SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
SPOTIFY_API_BASE = 'https://api.spotify.com/v1'
SPOTIFY_SCOPES = 'streaming user-read-email user-read-private user-library-read user-read-playback-state user-modify-playback-state playlist-read-private'
APP_TIMEZONE = os.getenv('APP_TIMEZONE', 'America/Sao_Paulo')
try:
    LOCAL_TZ = ZoneInfo(APP_TIMEZONE)
except ZoneInfoNotFoundError:
    LOCAL_TZ = timezone(timedelta(hours=-3), 'America/Sao_Paulo') if APP_TIMEZONE == 'America/Sao_Paulo' else timezone.utc


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def local_now():
    return datetime.now(LOCAL_TZ)


def local_today():
    return local_now().date()


# ── Models ──────────────────────────────────────────────────────────────────

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(150), unique=True, nullable=False)
    password_hash = db.Column(db.String(255))
    spotify_id = db.Column(db.String(100))
    spotify_access_token = db.Column(db.Text)
    spotify_refresh_token = db.Column(db.Text)
    spotify_token_expires = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=utc_now)
    settings = db.relationship('PomodoroSettings', backref='user', uselist=False, cascade='all, delete-orphan')
    sessions = db.relationship('PomodoroSession', backref='user', cascade='all, delete-orphan')

    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    def check_password(self, password):
        if not self.password_hash:
            return False
        return bcrypt.check_password_hash(self.password_hash, password)

    @property
    def spotify_connected(self):
        return bool(self.spotify_access_token)

    def get_valid_spotify_token(self):
        if not self.spotify_access_token:
            return None
        if self.spotify_token_expires and utc_now() >= self.spotify_token_expires:
            return self._refresh_spotify_token()
        return self.spotify_access_token

    def _refresh_spotify_token(self):
        if not self.spotify_refresh_token:
            return None
        try:
            resp = requests.post(SPOTIFY_TOKEN_URL, data={
                'grant_type': 'refresh_token',
                'refresh_token': self.spotify_refresh_token,
                'client_id': SPOTIFY_CLIENT_ID,
                'client_secret': SPOTIFY_CLIENT_SECRET,
            })
            data = resp.json()
            if 'access_token' in data:
                self.spotify_access_token = data['access_token']
                self.spotify_token_expires = utc_now() + timedelta(seconds=data.get('expires_in', 3600))
                if 'refresh_token' in data:
                    self.spotify_refresh_token = data['refresh_token']
                db.session.commit()
                return self.spotify_access_token
        except Exception:
            pass
        return None


class PomodoroSettings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    focus_minutes = db.Column(db.Integer, default=25)
    break_minutes = db.Column(db.Integer, default=5)
    cycles = db.Column(db.Integer, default=4)
    auto_music = db.Column(db.Boolean, default=True)
    pause_on_break = db.Column(db.Boolean, default=True)


class PomodoroSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    date = db.Column(db.Date, default=local_today)
    cycles_completed = db.Column(db.Integer, default=0)
    focus_minutes_total = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=utc_now)


class HourlySession(db.Model):
    """Tracks focus minutes per hour-of-day for productivity insights."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    hour = db.Column(db.Integer, nullable=False)  # 0-23
    minutes = db.Column(db.Integer, default=0)
    cycles = db.Column(db.Integer, default=0)


class Mission(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    mission_key = db.Column(db.String(50), nullable=False)  # e.g. '3_pomodoros', 'no_skip', 'playlist'
    completed = db.Column(db.Boolean, default=False)
    completed_at = db.Column(db.DateTime)


class Goal(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    type = db.Column(db.String(20), nullable=False)  # 'minutes' or 'cycles'
    target = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=utc_now)
    active = db.Column(db.Boolean, default=True)


class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(50), default='pessoal')  # estudo, trabalho, pessoal
    period = db.Column(db.String(20), default='daily')       # daily, weekly, monthly
    completed = db.Column(db.Boolean, default=False)
    completed_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=utc_now)
    due_date = db.Column(db.Date)


class ScheduleBlock(db.Model):
    """Time-blocking schedule block."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    title = db.Column(db.String(200), nullable=False)
    start_time = db.Column(db.String(5), nullable=False)   # "HH:MM"
    end_time = db.Column(db.String(5), nullable=False)     # "HH:MM"
    color = db.Column(db.String(20), default='accent')     # accent, green, orange, pink, blue
    status = db.Column(db.String(20), default='pending')   # pending, in_progress, done
    position = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=utc_now)


class ScheduleTemplate(db.Model):
    """Reusable daily routine template."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    blocks_json = db.Column(db.Text, nullable=False)  # JSON list of block dicts
    created_at = db.Column(db.DateTime, default=utc_now)



@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


# ── Auth Routes ──────────────────────────────────────────────────────────────

@app.route('/')
def index():
    if current_user.is_authenticated:
        return redirect(url_for('app_view'))
    return redirect(url_for('login'))


@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('app_view'))
    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        user = User.query.filter_by(email=email).first()
        if user and user.check_password(password):
            login_user(user, remember=True)
            return redirect(url_for('app_view'))
        flash('Email ou senha incorretos.', 'error')
    return render_template('login.html')


@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('app_view'))
    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        if not email or not password:
            flash('Preencha todos os campos.', 'error')
            return render_template('register.html')
        if len(password) < 6:
            flash('Senha deve ter pelo menos 6 caracteres.', 'error')
            return render_template('register.html')
        if User.query.filter_by(email=email).first():
            flash('Este email já está cadastrado.', 'error')
            return render_template('register.html')
        user = User(email=email)
        user.set_password(password)
        settings = PomodoroSettings(user=user)
        db.session.add(user)
        db.session.add(settings)
        db.session.commit()
        login_user(user, remember=True)
        return redirect(url_for('app_view'))
    return render_template('register.html')


@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))


# ── Spotify OAuth ────────────────────────────────────────────────────────────

@app.route('/spotify/connect')
@login_required
def spotify_connect():
    if not SPOTIFY_CLIENT_ID:
        flash('Spotify não configurado. Adicione as credenciais no .env', 'error')
        return redirect(url_for('app_view'))
    params = {
        'client_id': SPOTIFY_CLIENT_ID,
        'response_type': 'code',
        'redirect_uri': SPOTIFY_REDIRECT_URI,
        'scope': SPOTIFY_SCOPES,
        'show_dialog': 'false',
    }
    auth_url = SPOTIFY_AUTH_URL + '?' + urllib.parse.urlencode(params)
    return redirect(auth_url)


@app.route('/callback')
@login_required
def spotify_callback():
    code = request.args.get('code')
    error = request.args.get('error')
    if error or not code:
        flash('Autorização Spotify negada.', 'error')
        return redirect(url_for('app_view'))
    try:
        resp = requests.post(SPOTIFY_TOKEN_URL, data={
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': SPOTIFY_REDIRECT_URI,
            'client_id': SPOTIFY_CLIENT_ID,
            'client_secret': SPOTIFY_CLIENT_SECRET,
        })
        data = resp.json()
        if 'access_token' not in data:
            flash('Erro ao obter token Spotify.', 'error')
            return redirect(url_for('app_view'))
        current_user.spotify_access_token = data['access_token']
        current_user.spotify_refresh_token = data.get('refresh_token')
        current_user.spotify_token_expires = utc_now() + timedelta(seconds=data.get('expires_in', 3600))
        profile_resp = requests.get(f'{SPOTIFY_API_BASE}/me', headers={'Authorization': f'Bearer {data["access_token"]}'})
        profile = profile_resp.json()
        current_user.spotify_id = profile.get('id')
        db.session.commit()
        flash('Spotify conectado com sucesso!', 'success')
    except Exception as e:
        flash('Erro ao conectar Spotify.', 'error')
    return redirect(url_for('app_view'))


@app.route('/spotify/disconnect')
@login_required
def spotify_disconnect():
    current_user.spotify_access_token = None
    current_user.spotify_refresh_token = None
    current_user.spotify_token_expires = None
    current_user.spotify_id = None
    db.session.commit()
    return redirect(url_for('app_view'))


# ── Main App ─────────────────────────────────────────────────────────────────

@app.route('/app')
@login_required
def app_view():
    settings = current_user.settings or PomodoroSettings(user=current_user)
    token = current_user.get_valid_spotify_token() if current_user.spotify_connected else None
    today = local_today()
    today_session = PomodoroSession.query.filter_by(user_id=current_user.id, date=today).first()
    return render_template('app.html',
        user=current_user,
        settings=settings,
        spotify_token=token,
        today_session=today_session,
        spotify_client_id=SPOTIFY_CLIENT_ID,
    )


# ── API Endpoints ────────────────────────────────────────────────────────────

@app.route('/api/settings', methods=['POST'])
@login_required
def update_settings():
    data = request.get_json()
    settings = current_user.settings
    if not settings:
        settings = PomodoroSettings(user=current_user)
        db.session.add(settings)
    settings.focus_minutes = int(data.get('focus_minutes', 25))
    settings.break_minutes = int(data.get('break_minutes', 5))
    settings.cycles = int(data.get('cycles', 4))
    settings.auto_music = bool(data.get('auto_music', True))
    settings.pause_on_break = bool(data.get('pause_on_break', True))
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/session/complete', methods=['POST'])
@login_required
def complete_session():
    data = request.get_json(silent=True) or {}
    try:
        cycles = max(0, int(data.get('cycles', 1)))
        focus_min = max(0, int(data.get('focus_minutes', 25)))
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'invalid_payload'}), 400
    if cycles <= 0 or focus_min <= 0:
        return jsonify({'ok': False, 'error': 'invalid_session'}), 400
    skipped = bool(data.get('skipped', False))
    today = local_today()
    now = local_now()
    current_hour = now.hour

    session_rec = PomodoroSession.query.filter_by(user_id=current_user.id, date=today).first()
    if not session_rec:
        session_rec = PomodoroSession(
            user_id=current_user.id,
            date=today,
            cycles_completed=0,
            focus_minutes_total=0,
        )
        db.session.add(session_rec)
    session_rec.cycles_completed = (session_rec.cycles_completed or 0) + cycles
    session_rec.focus_minutes_total = (session_rec.focus_minutes_total or 0) + focus_min

    # Track hourly data
    hourly = HourlySession.query.filter_by(user_id=current_user.id, hour=current_hour).first()
    if not hourly:
        hourly = HourlySession(user_id=current_user.id, hour=current_hour, minutes=0, cycles=0)
        db.session.add(hourly)
    hourly.minutes = (hourly.minutes or 0) + focus_min
    hourly.cycles = (hourly.cycles or 0) + cycles

    # Update missions
    completed_missions = _update_missions(current_user.id, today, session_rec, skipped)

    db.session.commit()
    missions, total_xp, max_xp = _mission_payload(current_user.id, today)
    return jsonify({
        'ok': True,
        'session': {
            'date': str(today),
            'cycles': session_rec.cycles_completed,
            'minutes': session_rec.focus_minutes_total,
        },
        'total_cycles': session_rec.cycles_completed,
        'completed_missions': completed_missions,
        'missions': missions,
        'total_xp': total_xp,
        'max_xp': max_xp,
    })


def _update_missions(user_id, today, session_rec, skipped):
    MISSIONS = _get_daily_missions()
    completed_keys = []
    for m in MISSIONS:
        existing = Mission.query.filter_by(user_id=user_id, date=today, mission_key=m['key']).first()
        if not existing:
            existing = Mission(user_id=user_id, date=today, mission_key=m['key'])
            db.session.add(existing)
        if existing.completed:
            continue
        completed = False
        if m['key'] == '3_pomodoros' and session_rec.cycles_completed >= 3:
            completed = True
        elif m['key'] == 'focus_60min' and session_rec.focus_minutes_total >= 60:
            completed = True
        elif m['key'] == 'no_skip' and not skipped:
            completed = True
        if completed:
            existing.completed = True
            existing.completed_at = utc_now()
            completed_keys.append(m['key'])
    return completed_keys


def _get_daily_missions():
    return [
        {'key': '3_pomodoros', 'label': 'Complete 3 pomodoros', 'icon': 'timer', 'xp': 30},
        {'key': 'focus_60min', 'label': 'Foque por 60 minutos', 'icon': 'target', 'xp': 40},
        {'key': 'no_skip', 'label': 'Complete 1 ciclo sem pular', 'icon': 'check', 'xp': 20},
    ]


def _mission_payload(user_id, today):
    missions_def = _get_daily_missions()
    result = []
    for m in missions_def:
        record = Mission.query.filter_by(user_id=user_id, date=today, mission_key=m['key']).first()
        result.append({
            'key': m['key'],
            'label': m['label'],
            'icon': m['icon'],
            'xp': m['xp'],
            'completed': bool(record and record.completed),
        })
    total_xp = sum(m['xp'] for m in result if m['completed'])
    max_xp = sum(m['xp'] for m in missions_def)
    return result, total_xp, max_xp


@app.route('/api/spotify/token')
@login_required
def get_spotify_token():
    token = current_user.get_valid_spotify_token()
    if not token:
        return jsonify({'error': 'not_connected'}), 401
    return jsonify({'token': token})


@app.route('/api/spotify/search')
@login_required
def spotify_search():
    q = request.args.get('q', '')
    token = current_user.get_valid_spotify_token()
    if not token or not q:
        return jsonify({'tracks': []})
    try:
        resp = requests.get(
            f'{SPOTIFY_API_BASE}/search',
            params={'q': q, 'type': 'track', 'limit': 8},
            headers={'Authorization': f'Bearer {token}'},
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({'tracks': [], 'error': f'spotify_error_{resp.status_code}'})
        data = resp.json()
        tracks = []
        for item in (data.get('tracks', {}).get('items') or []):
            if not item:
                continue
            tracks.append({
                'id': item['id'],
                'uri': item['uri'],
                'name': item['name'],
                'artist': ', '.join(a['name'] for a in item.get('artists', [])),
                'album': item.get('album', {}).get('name', ''),
                'image': item['album']['images'][0]['url'] if item.get('album', {}).get('images') else None,
                'duration_ms': item.get('duration_ms', 0),
            })
        return jsonify({'tracks': tracks})
    except Exception as e:
        return jsonify({'tracks': [], 'error': str(e)})


@app.route('/api/spotify/playlists')
@login_required
def spotify_playlists():
    token = current_user.get_valid_spotify_token()
    if not token:
        return jsonify({'playlists': [], 'error': 'not_connected'})
    try:
        resp = requests.get(
            f'{SPOTIFY_API_BASE}/me/playlists',
            params={'limit': 50},
            headers={'Authorization': f'Bearer {token}'},
            timeout=10,
        )
        if resp.status_code == 401:
            # Token expired even after refresh attempt — clear it
            current_user.spotify_access_token = None
            db.session.commit()
            return jsonify({'playlists': [], 'error': 'token_expired'})
        if resp.status_code != 200:
            return jsonify({'playlists': [], 'error': f'spotify_error_{resp.status_code}'})
        data = resp.json()
        playlists = []
        for item in (data.get('items') or []):
            if not item:
                continue
            images = item.get('images') or []
            tracks_info = item.get('tracks')
            track_count = tracks_info.get('total', 0) if isinstance(tracks_info, dict) else 0
            playlists.append({
                'id': item['id'],
                'uri': item['uri'],
                'name': item['name'],
                'tracks': track_count,
                'image': images[0]['url'] if images else None,
            })
        return jsonify({'playlists': playlists})
    except Exception as e:
        return jsonify({'playlists': [], 'error': str(e)})


@app.route('/api/spotify/search_playlists')
@login_required
def spotify_search_playlists():
    q = request.args.get('q', '')
    token = current_user.get_valid_spotify_token()
    if not token or not q:
        return jsonify({'playlists': []})
    try:
        resp = requests.get(
            f'{SPOTIFY_API_BASE}/search',
            params={'q': q, 'type': 'playlist', 'limit': 6},
            headers={'Authorization': f'Bearer {token}'},
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({'playlists': []})
        data = resp.json()
        playlists = []
        for item in (data.get('playlists', {}).get('items') or []):
            if not item:
                continue
            images = item.get('images') or []
            playlists.append({
                'id': item['id'],
                'uri': item['uri'],
                'name': item['name'],
                'tracks': item.get('tracks', {}).get('total', 0) if isinstance(item.get('tracks'), dict) else 0,
                'image': images[0]['url'] if images else None,
            })
        return jsonify({'playlists': playlists})
    except Exception as e:
        return jsonify({'playlists': [], 'error': str(e)})



@app.route('/api/spotify/playlist/<playlist_id>/tracks')
@login_required
def spotify_playlist_tracks(playlist_id):
    token = current_user.get_valid_spotify_token()
    if not token:
        return jsonify({'tracks': [], 'error': 'not_connected'})
    try:
        resp = requests.get(
            f'{SPOTIFY_API_BASE}/playlists/{playlist_id}/tracks',
            params={'limit': 50},
            headers={'Authorization': f'Bearer {token}'},
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({'tracks': [], 'error': f'spotify_error_{resp.status_code}'})
        data = resp.json()
        tracks = []
        for item in (data.get('items') or []):
            t = item.get('track') if isinstance(item, dict) else None
            if not t or not isinstance(t, dict) or not t.get('uri'):
                continue
            images = (t.get('album') or {}).get('images') or []
            tracks.append({
                'id': t.get('id', ''),
                'uri': t['uri'],
                'name': t.get('name', 'Sem título'),
                'artist': ', '.join(a['name'] for a in t.get('artists', []) if isinstance(a, dict)),
                'image': images[0]['url'] if images else None,
                'duration_ms': t.get('duration_ms', 0),
            })
        return jsonify({'tracks': tracks})
    except Exception as e:
        return jsonify({'tracks': [], 'error': str(e)})


# ── Jamendo API ───────────────────────────────────────────────────────────────

JAMENDO_CLIENT_ID = os.getenv('JAMENDO_CLIENT_ID', '').strip()
JAMENDO_API_BASE = 'https://api.jamendo.com/v3.0'

JAMENDO_FOCUS_PLAYLISTS = [
    {
        'id': 'study',
        'name': 'Study Focus',
        'label': 'Study Focus',
        'tag': 'study',
        'params': {'fuzzytags': 'relaxation+soundtrack+classical', 'vocalinstrumental': 'instrumental'},
    },
    {
        'id': 'chill',
        'name': 'Chill Beats',
        'label': 'Chill Beats',
        'tag': 'chill',
        'params': {'fuzzytags': 'relaxation+lounge+jazz'},
    },
    {
        'id': 'ambient',
        'name': 'Ambient Focus',
        'label': 'Ambient Focus',
        'tag': 'ambient',
        'params': {'fuzzytags': 'relaxation+soundtrack', 'vocalinstrumental': 'instrumental'},
    },
    {
        'id': 'electronic',
        'name': 'Electronic Flow',
        'label': 'Electronic Flow',
        'tag': 'electronic',
        'params': {'tags': 'electronic', 'featured': 1},
    },
    {
        'id': 'instrumental',
        'name': 'Instrumental',
        'label': 'Instrumental',
        'tag': 'instrumental',
        'params': {'fuzzytags': 'classical+soundtrack+relaxation', 'vocalinstrumental': 'instrumental'},
    },
    {
        'id': 'relax',
        'name': 'Deep Relax',
        'label': 'Deep Relax',
        'tag': 'relax',
        'params': {'tags': 'relaxation', 'featured': 1},
    },
]

JAMENDO_PLAYLIST_BY_TAG = {playlist['tag']: playlist for playlist in JAMENDO_FOCUS_PLAYLISTS}


def _bounded_int(value, default=20, minimum=1, maximum=50):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(parsed, maximum))


def _jamendo_error(code, message, status=502):
    return jsonify({'tracks': [], 'error': code, 'message': message}), status


def _jamendo_request(params, limit):
    if not JAMENDO_CLIENT_ID:
        return None, ('not_configured', 'Configure JAMENDO_CLIENT_ID no arquivo .env.', 503)

    query = {
        'client_id': JAMENDO_CLIENT_ID,
        'format': 'json',
        'limit': limit,
        'audioformat': 'mp32',
        'include': 'musicinfo',
        'imagesize': 300,
        'groupby': 'artist_id',
        **params,
    }

    try:
        resp = requests.get(f'{JAMENDO_API_BASE}/tracks/', params=query, timeout=10)
        data = resp.json()
    except requests.RequestException:
        return None, ('network_error', 'Nao foi possivel conectar ao Jamendo agora.', 502)
    except ValueError:
        return None, ('invalid_response', 'O Jamendo retornou uma resposta invalida.', 502)

    headers = data.get('headers') or {}
    api_status = headers.get('status')
    api_code = headers.get('code')
    warning = headers.get('warnings') or ''
    api_message = headers.get('error_message') or ''

    if resp.status_code != 200 or api_status != 'success' or api_code not in (0, '0', None):
        return None, (
            'jamendo_error',
            api_message or f'Erro Jamendo HTTP {resp.status_code}.',
            502,
        )

    if 'usage limits are exceeded' in warning.lower() and not data.get('results'):
        return None, (
            'rate_limited',
            'A chave Jamendo configurada atingiu o limite de uso. Crie uma chave propria no painel do Jamendo e atualize JAMENDO_CLIENT_ID.',
            429,
        )

    return data, None


def _jamendo_track_payload(track):
    musicinfo = track.get('musicinfo') or {}
    tag_data = musicinfo.get('tags') or {}
    tags = []
    for key in ('genres', 'instruments', 'vartags'):
        values = tag_data.get(key) or []
        if isinstance(values, list):
            tags.extend(values)

    return {
        'id': track.get('id'),
        'name': track.get('name', ''),
        'artist': track.get('artist_name', ''),
        'album': track.get('album_name', ''),
        'image': track.get('album_image') or track.get('image') or '',
        'audio': track.get('audio', ''),
        'duration': track.get('duration', 0),
        'tags': tags,
    }

@app.route('/api/jamendo/focus')
@login_required
def jamendo_focus():
    """Return curated focus tracks from Jamendo."""
    tag = request.args.get('tags', 'study').strip().lower()
    limit = _bounded_int(request.args.get('limit'), default=20)
    playlist = JAMENDO_PLAYLIST_BY_TAG.get(tag)
    params = {
        'order': 'popularity_month_desc',
        **(playlist['params'] if playlist else {'fuzzytags': tag.replace(' ', '+')}),
    }
    data, error = _jamendo_request(params, limit)
    if error:
        return _jamendo_error(*error)

    tracks = [_jamendo_track_payload(track) for track in (data.get('results') or []) if track.get('audio')]
    return jsonify({
        'tracks': tracks,
        'tags': tag,
        'label': playlist['label'] if playlist else tag.title(),
    })

@app.route('/api/jamendo/search')
@login_required
def jamendo_search():
    q     = request.args.get('q', '').strip()
    limit = _bounded_int(request.args.get('limit'), default=15)
    if not q:
        return jsonify({'tracks': []})
    data, error = _jamendo_request({'search': q, 'order': 'relevance'}, limit)
    if error:
        return _jamendo_error(*error)

    tracks = [_jamendo_track_payload(track) for track in (data.get('results') or []) if track.get('audio')]
    return jsonify({'tracks': tracks})

@app.route('/api/jamendo/playlists')
@login_required
def jamendo_playlists():
    """Return focus-themed virtual playlists (one per tag)."""
    return jsonify({'playlists': [
        {'id': item['id'], 'name': item['name'], 'tag': item['tag'], 'image': ''}
        for item in JAMENDO_FOCUS_PLAYLISTS
    ]})

@app.route('/api/stats')
@login_required
def get_stats():
    sessions = PomodoroSession.query.filter_by(user_id=current_user.id).order_by(PomodoroSession.date.desc()).limit(7).all()
    return jsonify({'sessions': [
        {'date': str(s.date), 'cycles': s.cycles_completed, 'minutes': s.focus_minutes_total}
        for s in sessions
    ]})


@app.route('/api/stats/insights')
@login_required
def get_stats_insights():
    sessions = PomodoroSession.query.filter_by(user_id=current_user.id).order_by(PomodoroSession.date.desc()).limit(7).all()

    # Best hour of day
    hourly = HourlySession.query.filter_by(user_id=current_user.id).all()
    best_hour = None
    best_hour_label = None
    if hourly:
        best = max(hourly, key=lambda h: h.minutes)
        best_hour = best.hour
        suffix = 'h'
        best_hour_label = f"{best.hour:02d}:00"

    # Streak
    all_sessions = PomodoroSession.query.filter_by(user_id=current_user.id).order_by(PomodoroSession.date.desc()).all()
    streak = 0
    check = local_today()
    for s in all_sessions:
        if s.date == check and s.cycles_completed > 0:
            streak += 1
            check -= timedelta(days=1)
        elif s.date < check:
            break

    total_min = sum(s.focus_minutes_total for s in sessions)
    total_cycles = sum(s.cycles_completed for s in sessions)

    insight_msg = None
    if best_hour is not None:
        insight_msg = f"Você rende mais às {best_hour_label}"

    return jsonify({
        'total_minutes_7d': total_min,
        'total_cycles_7d': total_cycles,
        'streak': streak,
        'best_hour': best_hour,
        'best_hour_label': best_hour_label,
        'insight': insight_msg,
        'hourly': [{'hour': h.hour, 'minutes': h.minutes} for h in sorted(hourly, key=lambda x: x.hour)],
        'sessions': [{'date': str(s.date), 'cycles': s.cycles_completed, 'minutes': s.focus_minutes_total} for s in sessions],
    })


@app.route('/api/missions')
@login_required
def get_missions():
    today = local_today()
    result, total_xp, max_xp = _mission_payload(current_user.id, today)
    return jsonify({'missions': result, 'total_xp': total_xp, 'max_xp': max_xp})


@app.route('/api/missions/complete', methods=['POST'])
@login_required
def complete_mission():
    data = request.get_json()
    key = data.get('key')
    today = local_today()
    valid_keys = [m['key'] for m in _get_daily_missions()]
    if key not in valid_keys:
        return jsonify({'error': 'invalid'}), 400
    record = Mission.query.filter_by(user_id=current_user.id, date=today, mission_key=key).first()
    if not record:
        record = Mission(user_id=current_user.id, date=today, mission_key=key)
        db.session.add(record)
    record.completed = True
    record.completed_at = utc_now()
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/goals', methods=['GET'])
@login_required
def get_goals():
    goals = Goal.query.filter_by(user_id=current_user.id, active=True).all()
    today = local_today()
    today_session = PomodoroSession.query.filter_by(user_id=current_user.id, date=today).first()
    today_minutes = today_session.focus_minutes_total if today_session else 0
    today_cycles = today_session.cycles_completed if today_session else 0

    # Calculate streak for each goal
    all_sessions = PomodoroSession.query.filter_by(user_id=current_user.id).order_by(PomodoroSession.date.desc()).all()
    sessions_by_date = {s.date: s for s in all_sessions}

    result = []
    for g in goals:
        streak = 0
        check_date = today
        while True:
            s = sessions_by_date.get(check_date)
            if not s:
                break
            val = s.focus_minutes_total if g.type == 'minutes' else s.cycles_completed
            if val >= g.target:
                streak += 1
                check_date -= timedelta(days=1)
            else:
                break

        current_val = today_minutes if g.type == 'minutes' else today_cycles
        result.append({
            'id': g.id,
            'type': g.type,
            'target': g.target,
            'current': current_val,
            'streak': streak,
            'done': current_val >= g.target,
        })

    return jsonify({'goals': result, 'today_minutes': today_minutes, 'today_cycles': today_cycles})


@app.route('/api/goals', methods=['POST'])
@login_required
def create_goal():
    data = request.get_json()
    gtype = data.get('type')
    target = int(data.get('target', 0))
    if gtype not in ('minutes', 'cycles') or target <= 0:
        return jsonify({'error': 'invalid'}), 400
    # Deactivate existing goal of same type
    Goal.query.filter_by(user_id=current_user.id, type=gtype, active=True).update({'active': False})
    goal = Goal(user_id=current_user.id, type=gtype, target=target)
    db.session.add(goal)
    db.session.commit()
    return jsonify({'ok': True, 'id': goal.id})


@app.route('/api/goals/<int:goal_id>', methods=['DELETE'])
@login_required
def delete_goal(goal_id):
    goal = Goal.query.filter_by(id=goal_id, user_id=current_user.id).first_or_404()
    goal.active = False
    db.session.commit()
    return jsonify({'ok': True})


# ── Tasks API ────────────────────────────────────────────────────────────────

VALID_CATEGORIES = ('estudo', 'trabalho', 'pessoal')
VALID_PERIODS = ('daily', 'weekly', 'monthly')


@app.route('/api/tasks', methods=['GET'])
@login_required
def get_tasks():
    period = request.args.get('period', 'daily')
    category = request.args.get('category', None)
    today = local_today()

    query = Task.query.filter_by(user_id=current_user.id)
    if period in VALID_PERIODS:
        query = query.filter_by(period=period)
    if category in VALID_CATEGORIES:
        query = query.filter_by(category=category)

    tasks = query.order_by(Task.created_at.desc()).all()

    # Progress counts
    total = len(tasks)
    done = sum(1 for t in tasks if t.completed)

    return jsonify({
        'tasks': [{
            'id': t.id,
            'title': t.title,
            'category': t.category,
            'period': t.period,
            'completed': t.completed,
            'completed_at': t.completed_at.isoformat() if t.completed_at else None,
            'created_at': t.created_at.isoformat(),
        } for t in tasks],
        'progress': {'total': total, 'done': done},
    })


@app.route('/api/tasks', methods=['POST'])
@login_required
def create_task():
    data = request.get_json()
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'title required'}), 400
    category = data.get('category', 'pessoal')
    if category not in VALID_CATEGORIES:
        category = 'pessoal'
    period = data.get('period', 'daily')
    if period not in VALID_PERIODS:
        period = 'daily'
    task = Task(user_id=current_user.id, title=title, category=category, period=period)
    db.session.add(task)
    db.session.commit()
    return jsonify({'ok': True, 'id': task.id})


@app.route('/api/tasks/<int:task_id>', methods=['PATCH'])
@login_required
def update_task(task_id):
    task = Task.query.filter_by(id=task_id, user_id=current_user.id).first_or_404()
    data = request.get_json()
    if 'title' in data:
        title = data['title'].strip()
        if title:
            task.title = title
    if 'completed' in data:
        task.completed = bool(data['completed'])
        task.completed_at = utc_now() if task.completed else None
    if 'category' in data and data['category'] in VALID_CATEGORIES:
        task.category = data['category']
    if 'period' in data and data['period'] in VALID_PERIODS:
        task.period = data['period']
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
@login_required
def delete_task(task_id):
    task = Task.query.filter_by(id=task_id, user_id=current_user.id).first_or_404()
    db.session.delete(task)
    db.session.commit()
    return jsonify({'ok': True})


# ── Schedule API ─────────────────────────────────────────────────────────────

def _block_dict(b):
    return {
        'id': b.id,
        'date': b.date.isoformat(),
        'title': b.title,
        'start_time': b.start_time,
        'end_time': b.end_time,
        'color': b.color,
        'status': b.status,
        'position': b.position,
    }


@app.route('/api/schedule', methods=['GET'])
@login_required
def get_schedule():
    from datetime import date as date_cls
    start_str = request.args.get('start')
    end_str = request.args.get('end')
    try:
        start = date_cls.fromisoformat(start_str)
        end = date_cls.fromisoformat(end_str)
    except Exception:
        today = local_today()
        start = end = today

    blocks = ScheduleBlock.query.filter(
        ScheduleBlock.user_id == current_user.id,
        ScheduleBlock.date >= start,
        ScheduleBlock.date <= end,
    ).order_by(ScheduleBlock.date, ScheduleBlock.start_time).all()

    grouped = {}
    for b in blocks:
        key = b.date.isoformat()
        grouped.setdefault(key, []).append(_block_dict(b))

    stats = {}
    for key, day_blocks in grouped.items():
        total = len(day_blocks)
        done = sum(1 for b in day_blocks if b['status'] == 'done')
        stats[key] = {'total': total, 'done': done, 'pct': round(done/total*100) if total else 0}

    return jsonify({'blocks': grouped, 'stats': stats})


@app.route('/api/schedule', methods=['POST'])
@login_required
def create_schedule_block():
    data = request.get_json()
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'title required'}), 400
    try:
        from datetime import date as date_cls
        date_val = date_cls.fromisoformat(data['date'])
    except Exception:
        return jsonify({'error': 'invalid date'}), 400
    start_time = data.get('start_time', '08:00')
    end_time = data.get('end_time', '09:00')
    color = data.get('color', 'accent')
    if color not in ('accent', 'green', 'orange', 'pink', 'blue', 'red'):
        color = 'accent'
    last = ScheduleBlock.query.filter_by(user_id=current_user.id, date=date_val)\
        .order_by(ScheduleBlock.position.desc()).first()
    position = (last.position + 1) if last else 0
    block = ScheduleBlock(
        user_id=current_user.id, date=date_val, title=title,
        start_time=start_time, end_time=end_time, color=color, position=position,
    )
    db.session.add(block)
    db.session.commit()
    return jsonify({'ok': True, 'block': _block_dict(block)})


@app.route('/api/schedule/<int:block_id>', methods=['PATCH'])
@login_required
def update_schedule_block(block_id):
    block = ScheduleBlock.query.filter_by(id=block_id, user_id=current_user.id).first_or_404()
    data = request.get_json()
    if 'title' in data and data['title'].strip():
        block.title = data['title'].strip()
    if 'start_time' in data:
        block.start_time = data['start_time']
    if 'end_time' in data:
        block.end_time = data['end_time']
    if 'color' in data and data['color'] in ('accent', 'green', 'orange', 'pink', 'blue', 'red'):
        block.color = data['color']
    if 'status' in data and data['status'] in ('pending', 'in_progress', 'done'):
        block.status = data['status']
    if 'position' in data:
        block.position = int(data['position'])
    db.session.commit()
    return jsonify({'ok': True, 'block': _block_dict(block)})


@app.route('/api/schedule/<int:block_id>', methods=['DELETE'])
@login_required
def delete_schedule_block(block_id):
    block = ScheduleBlock.query.filter_by(id=block_id, user_id=current_user.id).first_or_404()
    db.session.delete(block)
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/schedule/copy', methods=['POST'])
@login_required
def copy_schedule_day():
    from datetime import date as date_cls
    data = request.get_json()
    try:
        src = date_cls.fromisoformat(data['source_date'])
        tgt = date_cls.fromisoformat(data['target_date'])
    except Exception:
        return jsonify({'error': 'invalid dates'}), 400
    src_blocks = ScheduleBlock.query.filter_by(user_id=current_user.id, date=src)\
        .order_by(ScheduleBlock.position).all()
    ScheduleBlock.query.filter_by(user_id=current_user.id, date=tgt).delete()
    for b in src_blocks:
        new_b = ScheduleBlock(
            user_id=current_user.id, date=tgt,
            title=b.title, start_time=b.start_time, end_time=b.end_time,
            color=b.color, status='pending', position=b.position,
        )
        db.session.add(new_b)
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/schedule/templates', methods=['GET'])
@login_required
def get_templates():
    templates = ScheduleTemplate.query.filter_by(user_id=current_user.id)\
        .order_by(ScheduleTemplate.created_at.desc()).all()
    return jsonify({'templates': [
        {'id': t.id, 'name': t.name, 'blocks': json.loads(t.blocks_json)}
        for t in templates
    ]})


@app.route('/api/schedule/templates', methods=['POST'])
@login_required
def create_template():
    data = request.get_json()
    name = (data.get('name') or '').strip()
    blocks = data.get('blocks', [])
    if not name or not blocks:
        return jsonify({'error': 'name and blocks required'}), 400
    tpl = ScheduleTemplate(user_id=current_user.id, name=name, blocks_json=json.dumps(blocks))
    db.session.add(tpl)
    db.session.commit()
    return jsonify({'ok': True, 'id': tpl.id})


@app.route('/api/schedule/templates/<int:tpl_id>/apply', methods=['POST'])
@login_required
def apply_template(tpl_id):
    from datetime import date as date_cls
    tpl = ScheduleTemplate.query.filter_by(id=tpl_id, user_id=current_user.id).first_or_404()
    data = request.get_json()
    try:
        target = date_cls.fromisoformat(data['date'])
    except Exception:
        return jsonify({'error': 'invalid date'}), 400
    ScheduleBlock.query.filter_by(user_id=current_user.id, date=target).delete()
    blocks = json.loads(tpl.blocks_json)
    for i, b in enumerate(blocks):
        new_b = ScheduleBlock(
            user_id=current_user.id, date=target,
            title=b.get('title', ''), start_time=b.get('start_time', '08:00'),
            end_time=b.get('end_time', '09:00'), color=b.get('color', 'accent'),
            status='pending', position=i,
        )
        db.session.add(new_b)
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/schedule/templates/<int:tpl_id>', methods=['DELETE'])
@login_required
def delete_template(tpl_id):
    tpl = ScheduleTemplate.query.filter_by(id=tpl_id, user_id=current_user.id).first_or_404()
    db.session.delete(tpl)
    db.session.commit()
    return jsonify({'ok': True})

# ── Init ─────────────────────────────────────────────────────────────────────

with app.app_context():
    db.create_all()

if __name__ == '__main__':
    app.run(debug=True)
