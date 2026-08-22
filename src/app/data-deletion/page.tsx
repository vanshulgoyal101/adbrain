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
      <LegalPage title={TITLE} updated="22 August 2026">
        <p>
          If you want AdBrain to delete your data, email us at {" "}
          <a href="mailto:privacy@adbrain.vanshul.com">privacy@adbrain.vanshul.com</a>
          {" "}from the account email linked to your AdBrain workspace.
        </p>

        <h2>What to include in your request</h2>
        <ul>
          <li>Your AdBrain account email address.</li>
          <li>Your business/workspace name (if you have one).</li>
          <li>Whether you want full account deletion or only specific data removed.</li>
        </ul>

        <h2>What we delete</h2>
        <ul>
          <li>Brand profile details and uploaded brand assets stored in AdBrain.</li>
          <li>Campaign drafts, generated creatives, reports, and lead copies stored in AdBrain.</li>
          <li>Stored Meta connection credentials and related sync metadata.</li>
        </ul>

        <h2>What may remain</h2>
        <ul>
          <li>
            Records we are required to retain for legal, fraud-prevention, or security obligations.
          </li>
          <li>
            Data that exists in third-party systems (such as Meta) that you must delete from those
            systems directly.
          </li>
        </ul>

        <h2>Timeline</h2>
        <p>
          We verify request ownership and complete deletion within 30 days of a valid request.
        </p>
      </LegalPage>
    </>
  );
}
