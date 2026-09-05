import { redirect } from "next/navigation";
import { MarketingHome } from "@/components/marketing-home";
import { JsonLd } from "@/components/json-ld";
import { faqSchema } from "@/lib/seo/jsonLd";
import { getUser } from "@/lib/supabase/queries";

export default async function Home() {
  const user = await getUser();
  if (user) redirect("/dashboard");

  return (
    <>
      <JsonLd data={faqSchema()} />
      <MarketingHome />
    </>
  );
}
