export interface ResolvedPrintFile {
  url: string;
  filename: string;
}

/**
 * Resolve a Transfer by Size `_Print Ready` page URL to actual gang sheet image URLs.
 *
 * The `_Print Ready` URL is a page (not a direct image). We:
 * 1. Fetch it (get 302 redirect + session cookies)
 * 2. Follow redirect with cookies to get the Inertia.js HTML page
 * 3. Parse `data-page` JSON from the HTML
 * 4. Extract `designs[].gang_sheet_url` — the direct PNG download URLs
 */
export async function resolveGangSheetUrls(
  printReadyUrl: string
): Promise<ResolvedPrintFile[]> {
  try {
    // Step 1: fetch the initial URL without following redirects to capture cookies
    const initialRes = await fetch(printReadyUrl, { redirect: "manual", cache: "no-store" });
    const redirectUrl = initialRes.headers.get("location");
    if (!redirectUrl) {
      return [];
    }

    // Collect cookies from the response
    const setCookies = initialRes.headers.getSetCookie?.() || [];
    const cookieHeader = setCookies
      .map((c) => c.split(";")[0])
      .join("; ");

    // Step 2: follow redirect with cookies to get the HTML page
    const pageRes = await fetch(redirectUrl, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    const html = await pageRes.text();

    // Step 3: parse Inertia data-page attribute
    const match = html.match(/data-page="([^"]*)"/);
    if (!match) {
      return [];
    }

    const decoded = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/");

    const pageData = JSON.parse(decoded);

    // Step 4: extract gang_sheet_url from designs array
    const designs: Array<{
      gang_sheet_url?: string;
      file_name?: string;
      status?: string;
    }> = pageData?.props?.designs || [];

    return designs
      .filter((d) => d.gang_sheet_url && d.status === "completed")
      .map((d) => ({
        url: d.gang_sheet_url!,
        filename: d.file_name || "gang-sheet.png",
      }));
  } catch (e) {
    console.error("Failed to resolve gang sheet URLs:", e);
    return [];
  }
}

/**
 * Check if a URL is a direct image (Build a Gangsheet) vs a page URL (Transfer by Size).
 */
export function isDirectImageUrl(url: string): boolean {
  return (
    url.includes("/uploads/") ||
    url.includes("images.dripappsserver.com") ||
    url.includes(".r2.dev/") ||
    url.includes("r2.cloudflarestorage.com/")
  );
}
