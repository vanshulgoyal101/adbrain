import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { LegalPage } from "@/components/legal-page";
import { contentPageGraph } from "@/lib/seo/jsonLd";
import { metaDeletionStatus } from "@/lib/privacy-requests";

const TITLE = "Data Deletion Instructions";
const STATUS_LABEL = { received: "Received", in_review: "In review", completed: "Completed", declined: "Declined" } as const;
const STATUS_TEXT = {
  received: "We received your request from Facebook and disconnected AdBrain from your Meta account. An operator reviews it within 7 days.",
  in_review: "An operator is reviewing your request. We respond within 30 days.",
  completed: "We removed the AdBrain data covered by your request. Some records may remain, as listed below.",
  declined: "We couldn't act on this request. Use Settings or contact us with this code; we explain why in our reply.",
} as const;
const DESCRIPTION =
  "How to request deletion of your AdBrain account data and Meta-connected data from AdBrain systems.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/data-deletion" },
  openGraph: {
    title: `${TITLE} - AdBrain`,
    description: DESCRIPTION,
    url: "/data-deletion",
  },
};

export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const { code } = await searchParams;
  const confirmationCode = typeof code === "string" && /^[a-f0-9]{16}$/.test(code) ? code : null;
  // #730: the real status of the request Meta's callback recorded under this code.
  const status = confirmationCode ? await metaDeletionStatus(confirmationCode).catch(() => undefined) : undefined;
  return (
    <>
      <JsonLd
        data={contentPageGraph({
          path: "/data-deletion",
          name: TITLE,
          description: DESCRIPTION,
        })}
      />
      <LegalPage title={TITLE} updated="30 September 2026">
        {confirmationCode && (
          <>
            <h2>Your Meta deletion request</h2>
            <p role="status">
              Confirmation code <strong>{confirmationCode}</strong>.{" "}
              {status === null
                ? "We can't find a request with this code. If you asked Facebook to delete your AdBrain data, follow the steps below and include this code."
                : status === undefined
                  ? "We couldn't check its status just now. Reload this page in a minute."
                  : <>Status: <strong>{STATUS_LABEL[status]}</strong>. {STATUS_TEXT[status]}</>}
            </p>
          </>
        )}
        <p>
          To request an export or deletion of data AdBrain holds, sign in and use
          the Privacy and data requests section in <a href="/settings">Settings</a>.
          You can submit a request even if you have not set up a business yet.
          The page confirms receipt and shows the current status. Do not include
          passwords, payment details or lead contact information in a request.
        </p>

        <h2>Verification and status</h2>
        <p>
          Our operator reviews each request and verifies ownership of the account
          and workspace before sharing or removing data. We may ask you to confirm
          the scope. Exports are shared only through an agreed secure method after
          verification; there is no one-click full-account export or deletion.
        </p>

        <h2>Data covered by a request</h2>
        <p>
          We review AdBrain-held account and brand details, uploaded assets,
          campaign drafts and reports, generated creatives, lead copies and stored
          Meta connection details as applicable. We confirm what can be supplied
          or removed for your verified account before acting.
        </p>

        <h2>What may remain</h2>
        <ul>
          <li>
            Payment, invoice, refund, transaction and security records needed for
            legal, financial, fraud-prevention or security obligations.
          </li>
          <li>
            Data held by Meta or other providers. Removing AdBrain-held copies
            does not delete provider-side campaigns or lead data.
          </li>
        </ul>

        <h2>Timeline</h2>
        <p>
          We aim to review received requests within 7 calendar days and provide
          a response or status update within 30 calendar days after verifying
          ownership. If more time is needed, we will explain why and give you
          the next update date; not all records can necessarily be deleted.
        </p>
      </LegalPage>
    </>
  );
}
