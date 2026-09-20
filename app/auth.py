from authlib.integrations.starlette_client import OAuth
from fastapi import HTTPException, Request
from fastapi.responses import RedirectResponse
from .config import (
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
    ALLOWED_EMAIL_DOMAIN, ALLOWED_HOSTED_DOMAIN, AUTH_MODE, DEV_USER_EMAIL, DEV_USER_NAME
)

oauth = OAuth()
if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
    oauth.register(
        name="google",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

def require_google_config():
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise RuntimeError("Google OAuth is not configured.")

def is_allowed_email(email: str, hosted_domain: str | None = None) -> bool:
    email = (email or "").strip().lower()
    suffix = "@" + ALLOWED_EMAIL_DOMAIN
    if not email.endswith(suffix):
        return False
    if hosted_domain is None:
        return False
    return hosted_domain.strip().lower() == ALLOWED_HOSTED_DOMAIN


async def login(request: Request):
    if AUTH_MODE == "development":
        if not is_allowed_email(DEV_USER_EMAIL, ALLOWED_HOSTED_DOMAIN):
            raise HTTPException(403, "DEV_USER_EMAIL no autorizado para este dominio.")
        request.session["user"] = {
            "email": DEV_USER_EMAIL,
            "name": DEV_USER_NAME,
            "picture": "",
            "auth_mode": "development",
        }
        return RedirectResponse("/", status_code=303)
    require_google_config()
    redirect_uri = GOOGLE_REDIRECT_URI
    return await oauth.google.authorize_redirect(
        request,
        redirect_uri,
        hd=ALLOWED_HOSTED_DOMAIN,
        prompt="select_account",
    )

async def callback(request: Request):
    require_google_config()
    token = await oauth.google.authorize_access_token(request)
    userinfo = token.get("userinfo")
    if not userinfo:
        userinfo = await oauth.google.parse_id_token(request, token)
    email = str(userinfo.get("email", "")).lower()
    hosted = str(userinfo.get("hd", "")).lower()
    email_verified = bool(userinfo.get("email_verified", False))
    if not email_verified or not is_allowed_email(email, hosted):
        raise PermissionError("Cuenta no autorizada.")
    request.session["user"] = {
        "email": email,
        "name": userinfo.get("name") or email.split("@")[0],
        "picture": userinfo.get("picture", ""),
        "auth_mode": "google",
    }
    return request.session["user"]

def current_user(request: Request):
    return request.session.get("user")

def logout(request: Request):
    request.session.clear()
