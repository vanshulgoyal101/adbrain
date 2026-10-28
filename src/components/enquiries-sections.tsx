import type { ReactNode } from "react";
import { WhatsAppChats } from "@/components/whatsapp-chats";
import type { WhatsAppChatRow } from "@/lib/campaign/real-enquiries";

/**
 * #1223: WhatsApp chats are where a WhatsApp-first owner's results are, so they come first. The form table
 * (children) follows; with chats and no form enquiries it folds under "Form enquiries (0)", still reachable
 * for Sync. Without chats the form table is the page, as before.
 */
export function EnquiriesSections({ chatRows, formTotal, empty = false, children }: {
  chatRows: WhatsAppChatRow[];
  formTotal: number;
  /** #1597: no enquiries anywhere; the inbox shows one empty block, with no chat strips or "(0)" fold. */
  empty?: boolean;
  children: ReactNode;
}) {
  if (empty) return <>{children}</>;
  const fold = chatRows.length > 0 && formTotal === 0;
  return (
    <div className="flex flex-col gap-8">
      <WhatsAppChats rows={chatRows} />
      {fold ? (
        <details className="rounded-lg border border-slate-200 bg-white">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-slate-700">Form enquiries (0)</summary>
          <div className="border-t border-slate-200 p-4">{children}</div>
        </details>
      ) : children}
    </div>
  );
}
