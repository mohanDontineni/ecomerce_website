declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    MDCART_ALLOW_DEMO_BOOTSTRAP?: string;
    MDCART_BOOTSTRAP_PASSWORD?: string;
  }
}
