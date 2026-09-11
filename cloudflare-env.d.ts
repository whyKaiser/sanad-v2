declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    SANAD_USERNAME?: string;
    SANAD_PASSWORD_HASH?: string;
    SANAD_DISPLAY_NAME?: string;
    GROQ_API_KEY?: string;
    GROQ_MODEL?: string;
  }
}
