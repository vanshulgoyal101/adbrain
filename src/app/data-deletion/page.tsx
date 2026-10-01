import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { LegalPage } from "@/components/legal-page";
import { contentPageGraph } from "@/lib/seo/jsonLd";

const TITLE = "Data Deletion Instructions";
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

export default function DataDeletionPage() {
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
