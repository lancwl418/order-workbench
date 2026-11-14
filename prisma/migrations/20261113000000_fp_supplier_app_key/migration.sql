-- FP ERP suppliers carry an appKey besides the secret; stored as an env var
-- name, same convention as secret_key_env.
ALTER TABLE "suppliers" ADD COLUMN "app_key_env" TEXT;
