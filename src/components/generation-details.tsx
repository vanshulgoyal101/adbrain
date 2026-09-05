import { z } from "zod";

const receiptSchema = z.object({
  format: z.string(),
  composition: z.string(),
  textModels: z.array(z.object({ provider: z.string(), model: z.string() })),
  image: z.object({
    provider: z.string(),
    model: z.string(),
    fallbackFrom: z.string().optional(),
    estimatedCostUsd: z.number().nullable(),
  }),
  concept: z.object({ rationale: z.string() }),
});

export function GenerationDetails({ value }: { value: unknown }) {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) return null;
  const receipt = parsed.data;
  return (
    <details className="border-t border-slate-200 pt-3 text-xs text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">
        Generation details
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 break-words">
        <dt>Text</dt>
        <dd>
          {receipt.textModels
            .map((model) => `${model.provider}: ${model.model}`)
            .join(", ") || "Not reported"}
        </dd>
        <dt>Image</dt>
        <dd>
          {receipt.image.provider}: {receipt.image.model}
        </dd>
        <dt>Placement</dt>
        <dd>{receipt.format}</dd>
        <dt>Composition</dt>
        <dd>{receipt.composition}</dd>
        <dt>Image cost</dt>
        <dd>
          {receipt.image.estimatedCostUsd === null
            ? "Not reported"
            : `$${receipt.image.estimatedCostUsd.toFixed(4)}`}
        </dd>
      </dl>
      {receipt.image.fallbackFrom && (
        <p className="mt-2 font-medium text-amber-800">
          Fallback used after {receipt.image.fallbackFrom} failed.
        </p>
      )}
      <p className="mt-2">{receipt.concept.rationale}</p>
    </details>
  );
}
