import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { hashPassword } from "@/lib/password";
import { isSpecialistUser } from "@/lib/specialist";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const body = (req.body || {}) as any;
  const { room_id, name, password } = body;
  const roomId = String(room_id || "").trim();
  const roomName = typeof name === "string" ? String(name).trim() : "";
  const roomPwd = typeof password === "string" ? String(password).trim() : "";
  const hasAnalysisPrompt = Object.prototype.hasOwnProperty.call(body, "analysis_prompt");
  const roomAnalysisPrompt = hasAnalysisPrompt && typeof body.analysis_prompt === "string"
    ? String(body.analysis_prompt).replace(/\r\n/g, "\n")
    : "";

  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });
  if (!roomName && !roomPwd && !hasAnalysisPrompt) {
    return res.status(400).json({ ok: false, error: "Нужно указать название комнаты, новый пароль или промпт анализа" });
  }

  const { data: room, error: roomErr } = await supabaseAdmin
    .from("training_rooms")
    .select("id,created_by,name")
    .eq("id", roomId)
    .maybeSingle();

  if (roomErr) return res.status(500).json({ ok: false, error: roomErr.message });
  if (!room) return res.status(404).json({ ok: false, error: "Комната не найдена" });
  if (room.created_by && room.created_by !== user.id) return res.status(403).json({ ok: false, error: "Forbidden" });

  const patch: Record<string, any> = {};
  if (roomName) patch.name = roomName;
  else patch.name = String((room as any)?.name || "").trim();

  if (!patch.name) return res.status(400).json({ ok: false, error: "Название комнаты обязательно" });

  if (roomPwd) {
    try {
      patch.password_hash = hashPassword(roomPwd);
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e?.message || "Bad password" });
    }
  }

  if (hasAnalysisPrompt) {
    patch.analysis_prompt = roomAnalysisPrompt;
  }

  const { data, error } = await supabaseAdmin
    .from("training_rooms")
    .update(patch)
    .eq("id", roomId)
    .select("id,name")
    .single();

  if (error) {
    if (/analysis_prompt/i.test(error.message || "")) {
      return res.status(500).json({
        ok: false,
        error: "В базе нет поля analysis_prompt. Выполните SQL миграцию supabase/training_rooms_analysis_prompt.sql и повторите.",
      });
    }
    return res.status(500).json({ ok: false, error: error.message });
  }
  return res.status(200).json({ ok: true, room: data, password_updated: Boolean(roomPwd) });
}
