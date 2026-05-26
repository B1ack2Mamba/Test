import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import { setNoStore } from "@/lib/apiHardening";
import { extractFileText, previewFromText } from "@/lib/aiChatFiles";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "45mb",
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const files = Array.isArray(req.body?.files) ? req.body.files.slice(0, 4) : [];
  const previews = await Promise.all(
    files.map(async (file: any) => {
      const id = file?.id ? String(file.id) : undefined;
      const name = String(file?.name || "file");
      try {
        const extracted = await extractFileText(file);
        return {
          id,
          name: extracted.name,
          size: extracted.size,
          textChars: extracted.textChars,
          truncated: extracted.truncated,
          preview: previewFromText(extracted.text),
        };
      } catch (e: any) {
        return {
          id,
          name,
          error: e?.message || "Не удалось извлечь текст",
        };
      }
    })
  );

  return res.status(200).json({ ok: true, previews });
}
