import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadToR2 } from "@/lib/r2";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

// Allow large file uploads (gang sheets can be 300MB+)
export const maxDuration = 120;


/**
 * POST /api/upload
 *
 * Accepts a file upload (multipart/form-data) and stores it in R2.
 * Returns the public URL of the uploaded file.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Allowed: PNG, JPEG, WebP" },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large. Max 500MB" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() || "png";

  // Use original print filename if provided, prefixed with REPLACED
  const originalFilename = formData.get("originalFilename") as string | null;
  let key: string;
  if (originalFilename) {
    const baseName = originalFilename
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_().#-]/g, "-")
      .slice(0, 120);
    key = `prints/REPLACED-${baseName}.${ext}`;
  } else {
    const safeName = file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 80);
    key = `prints/${Date.now()}-${safeName}.${ext}`;
  }

  try {
    const url = await uploadToR2(buffer, key, file.type);
    return NextResponse.json({ url, key });
  } catch (e) {
    console.error("Upload failed:", e);
    return NextResponse.json(
      { error: "Upload failed. Check R2 configuration." },
      { status: 500 }
    );
  }
}
