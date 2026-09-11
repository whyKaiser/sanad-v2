declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    GROQ_API_KEY?: string;
    GROQ_MODEL?: string;
  }
}
