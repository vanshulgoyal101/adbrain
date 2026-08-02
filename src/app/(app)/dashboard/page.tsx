import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, ImageIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCreatives, getAuditLog, getPrimaryBusiness } from "@/lib/supabase/queries";

export default async function DashboardPage() {
  const business = await getPrimaryBusiness();
  const creatives = business ? await getCreatives(business.id) : [];
  const audit = business ? await getAuditLog(business.id, 8) : [];
  const drafts = creatives.filter((c) => c.status === "draft").length;
  const approved = creatives.filter((c) => c.status === "approved").length;

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome to AdBrain</h1>
        <p className="mt-1 text-slate-600">
          Let’s set up your Brand Brain — it powers every creative you generate.
        </p>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Building2 className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Create your Brand Brain
              </h2>
              <p className="mt-1 max-w-md text-sm text-slate-600">
                Add your business details, voice, and offers — or autofill them
                from your website in one click.
              </p>
            </div>
            <Link href="/brand">
              <Button>
                Set up Brand Brain <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = [
    { label: "Total creatives", value: creatives.length, icon: ImageIcon },
    { label: "Drafts", value: drafts, icon: Sparkles },
    { label: "Approved", value: approved, icon: CheckCircle2 },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{business.name}</h1>
          <p className="mt-1 text-slate-600">
            {business.description ?? "Your solar business dashboard."}
          </p>
        </div>
        <Link href="/studio">
          <Button>
            <Sparkles className="h-4 w-4" /> New creatives
          </Button>
        </Link>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-2xl font-bold text-slate-900">{value}</p>
                <p className="text-sm text-slate-500">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/brand">
          <Button variant="outline">
            <Building2 className="h-4 w-4" /> Edit Brand Brain
          </Button>
        </Link>
        <Link href="/studio">
          <Button variant="outline">
            <Sparkles className="h-4 w-4" /> Open Creative Studio
          </Button>
        </Link>
      </div>

      {creatives.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">
            Recent creatives
          </h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {creatives.slice(0, 6).map((c) => (
              <div
                key={c.id}
                className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
              >
                <div className="aspect-square">
                  {c.image_url && (
                    <img
                      src={c.image_url}
                      alt={c.headline ?? ""}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {audit.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">
            Recent activity
          </h2>
          <Card>
            <CardContent className="flex flex-col divide-y divide-slate-100 p-0">
              {audit.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
                >
                  <span className="truncate text-slate-700">
                    <span className="font-medium">{e.action}</span>
                    {e.reason ? ` — ${e.reason}` : ""}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {new Date(e.created_at).toLocaleString("en-IN")}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
