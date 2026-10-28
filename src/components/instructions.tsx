"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  deleteInstruction,
  saveInstruction,
} from "@/app/(app)/brand/instruction-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { AdInstruction } from "@/lib/types";

export function Instructions({
  businessId,
  instructions,
}: {
  businessId: string;
  instructions: AdInstruction[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>Ad instructions</CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="h-4 w-4" /> Add
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">
          Rules every ad follows, such as claims to avoid or words to use. Ads
          use the ones marked Active.
        </p>
        {adding && (
          <InstructionEditor
            businessId={businessId}
            onDone={() => setAdding(false)}
          />
        )}
        {instructions.length === 0 && !adding && (
          <p className="text-sm text-slate-400">No instructions yet.</p>
        )}
        {instructions.map((i) => (
          <InstructionEditor
            key={i.id}
            businessId={businessId}
            instruction={i}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function InstructionEditor({
  businessId,
  instruction,
  onDone,
}: {
  businessId: string;
  instruction?: AdInstruction;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(instruction?.title ?? "");
  const [content, setContent] = useState(instruction?.content ?? "");
  const [isActive, setIsActive] = useState(instruction?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await saveInstruction({
          id: instruction?.id,
          businessId,
          title,
          content,
          isActive,
        });
        if (!res.ok) {
          setError(res.error ?? "Could not save.");
          return;
        }
        onDone?.();
        router.refresh();
      } catch {
        setError("Could not save. Your edits are still here; check your connection and retry.");
      }
    });
  }

  async function remove() {
    if (!instruction) {
      onDone?.();
      return;
    }
    if (!(await confirm({ title: `Delete instruction “${instruction.title}”?`, confirmLabel: "Delete instruction", tone: "danger" }))) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await deleteInstruction(instruction.id, businessId);
        if (res.ok) router.refresh();
        else setError(res.error ?? "Could not delete.");
      } catch {
        setError("Could not delete. Check your connection and retry.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      {confirmDialog}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Instruction title (e.g. Tone & rules)"
          />
          <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active
          </label>
        </div>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          placeholder={
            "# How to write our ads\n- Always mention 25-year warranty\n- Avoid discount claims\n- Friendly, local tone"
          }
        />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={save} disabled={pending}>
            {pending ? <Spinner /> : <Save className="h-4 w-4" />}
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={remove}
            disabled={pending}
            className="text-slate-500"
          >
            <Trash2 className="h-4 w-4" /> {instruction ? "Delete" : "Cancel"}
          </Button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>
    </div>
  );
}
