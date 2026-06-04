const ADMIN_PASSWORD = 'SAADAA CONTROL';
const COOKIE_NAME = 'saadaa_admin_access';

function parseCookies(cookieHeader) {
    return Object.fromEntries(
        (cookieHeader || '')
            .split(';')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
                const index = part.indexOf('=');
                if (index === -1) return [part, ''];
                return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
            })
    );
}

async function accessToken() {
    const data = new TextEncoder().encode(ADMIN_PASSWORD);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function renderLogin(error = '') {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SAADAA CONTROL</title>
    <style>
        :root {
            --bg-dark: #0f172a;
            --sidebar-bg: #1e293b;
            --accent-primary: #3b82f6;
            --text-main: #f8fafc;
            --text-dim: #94a3b8;
            --border-color: #334155;
            --danger: #ef4444;
        }

        body {
            min-height: 100vh;
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            box-sizing: border-box;
            background: radial-gradient(circle at top, rgba(59, 130, 246, 0.18), transparent 34%), var(--bg-dark);
            color: var(--text-main);
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        form {
            width: min(420px, 100%);
            background: var(--sidebar-bg);
            border: 1px solid var(--border-color);
            border-radius: 14px;
            padding: 28px;
            box-shadow: 0 25px 60px rgba(0, 0, 0, 0.45);
        }

        h1 {
            margin: 0 0 8px 0;
            font-size: 1.35rem;
        }

        p {
            margin: 0 0 20px 0;
            color: var(--text-dim);
            font-size: 0.9rem;
        }

        label {
            display: block;
            margin-bottom: 8px;
            color: var(--text-dim);
            font-size: 0.8rem;
            font-weight: 600;
        }

        input {
            width: 100%;
            box-sizing: border-box;
            padding: 12px 14px;
            border-radius: 8px;
            border: 1px solid var(--border-color);
            background: rgba(15, 23, 42, 0.7);
            color: var(--text-main);
            outline: none;
            font-size: 1rem;
        }

        input:focus {
            border-color: var(--accent-primary);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
        }

        button {
            width: 100%;
            margin-top: 14px;
            padding: 12px;
            border: none;
            border-radius: 8px;
            background: var(--accent-primary);
            color: white;
            font-size: 0.95rem;
            font-weight: 700;
            cursor: pointer;
        }

        .error {
            min-height: 18px;
            margin-top: 10px;
            color: var(--danger);
            font-size: 0.82rem;
        }
    </style>
</head>
<body>
    <form method="POST" action="/admin.html">
        <h1>SAADAA CONTROL</h1>
        <p>Accès admin protégé.</p>
        <label for="password">Mot de passe</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus>
        <button type="submit">Entrer</button>
        <div class="error">${error}</div>
    </form>
</body>
</html>`;
}

function loginResponse(error = '', status = 200) {
    return new Response(renderLogin(error), {
        status,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

export default async function middleware(request) {
    const token = await accessToken();
    const cookies = parseCookies(request.headers.get('cookie'));

    if (cookies[COOKIE_NAME] === token) {
        return;
    }

    if (request.method === 'POST') {
        const formData = await request.formData();
        const password = formData.get('password');

        if (password === ADMIN_PASSWORD) {
            return new Response(null, {
                status: 303,
                headers: {
                    Location: new URL('/admin.html', request.url).toString(),
                    'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/admin.html; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
                    'Cache-Control': 'no-store',
                },
            });
        }

        return loginResponse('Mot de passe incorrect.', 401);
    }

    return loginResponse();
}

export const config = {
    matcher: '/admin.html',
};
