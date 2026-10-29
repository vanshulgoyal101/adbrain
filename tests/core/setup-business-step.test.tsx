// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { brandUsable } from "@/lib/brand/usable";
import { setupFieldErrors, setupFieldsFrom, setupLocations, setupPhone } from "@/lib/brand/setup-fields";
import type { Business } from "@/lib/types";

// #1269 (#1251 WS1 slice 2): step 1 'Your business' is the five brandUsable fields (#1136), saved as typed.
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  saveSetupBusiness: vi.fn(),
  saveAdLanguage: vi.fn(async () => ({ ok: true })),
  getUser: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  current: vi.fn(),
  written: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      select: () => ({ eq: () => ({ single: mocks.current }) }),
      insert: (payload: unknown) => { mocks.insert(payload); return { select: () => ({ single: mocks.written }) }; },
      update: (payload: unknown) => { mocks.update(payload); return { eq: () => ({ select: () => ({ single: mocks.written }) }) }; },
    }),
  }),
}));

const complete = { name: "SunPeak Solar", vertical: "Rooftop solar for homes", locations: "Jaipur\nAjmer", offer: "Free site survey", phone: "98765 43210" };

describe("core: setup fields (#1269)", () => {
  it("complete fields have no errors and make a usable Brand", () => {
    expect(setupFieldErrors(complete)).toEqual({});
    expect(brandUsable({ name: complete.name, vertical: complete.vertical, phone: complete.phone,
      locations: setupLocations(complete.locations), offers: [complete.offer] })).toBe(true);
  });

  it("each missing field says what to add, in the CPO's words", () => {
    expect(setupFieldErrors({ name: " ", vertical: "", locations: "\n", offer: "", phone: "12345" })).toEqual({
      name: "Add your business name.",
      vertical: "Say what you sell, in a few words.",
      locations: "Add at least one city or area.",
      offer: "Add one offer, like a free visit or a first-time price.",
      phone: "Enter a 10-digit mobile number.",
    });
  });

  it("a 10-digit mobile, with or without +91 or 0", () => {
    expect(setupPhone("98765 43210")).toBe("9876543210");
    expect(setupPhone("+91 98765-43210")).toBe("9876543210");
    expect(setupPhone("098765 43210")).toBe("9876543210");
    expect(setupPhone("12345 67890")).toBeNull();
    expect(setupPhone("98765")).toBeNull();
  });

  it("places are one per line; a comma stays inside the place", () => {
    expect(setupLocations("Malviya Nagar, Jaipur\n\n Ajmer ")).toEqual(["Malviya Nagar, Jaipur", "Ajmer"]);
  });

  it("reads a saved Brand back; the column default isn't shown as what you sell", () => {
    expect(setupFieldsFrom({ name: "A", vertical: "local business", locations: ["Jaipur", "Ajmer"], offers: ["Free visit", "10% off"], phone: "9876543210" }))
      .toEqual({ name: "A", vertical: "", locations: "Jaipur\nAjmer", offer: "Free visit", phone: "9876543210", usp: "" });
  });
});

describe("core: saveSetupBusiness writes only the five fields (#1269)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  it("updates in place, keeps other offers, and logs a usable Brand for the #1136 row", async () => {
    mocks.current.mockResolvedValue({ data: { offers: ["Old offer", "10% off on 5 kW"] }, error: null });
    mocks.written.mockResolvedValue({ data: { id: "b1", name: complete.name, vertical: complete.vertical, phone: complete.phone,
      locations: ["Jaipur", "Ajmer"], offers: ["Free site survey", "10% off on 5 kW"] }, error: null });
    const { saveSetupBusiness } = await import("@/app/(app)/brand/actions");
    await expect(saveSetupBusiness("b1", complete)).resolves.toEqual({ ok: true, id: "b1", usable: true });
    expect(mocks.update).toHaveBeenCalledWith({ name: complete.name, vertical: complete.vertical, phone: complete.phone,
      locations: ["Jaipur", "Ajmer"], offers: ["Free site survey", "10% off on 5 kW"] });
    expect(mocks.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "business.update", eventAttributes: { brandUsable: true } }));
  });

  it("never blanks a saved name or writes an unfinished phone", async () => {
    mocks.current.mockResolvedValue({ data: { offers: [] }, error: null });
    mocks.written.mockResolvedValue({ data: { id: "b1", name: "Saved", vertical: "local business", phone: null, locations: [], offers: [] }, error: null });
    const { saveSetupBusiness } = await import("@/app/(app)/brand/actions");
    await expect(saveSetupBusiness("b1", { name: "", vertical: "", locations: "", offer: "", phone: "98765" })).resolves.toMatchObject({ ok: true, usable: false });
    expect(mocks.update).toHaveBeenCalledWith({ locations: [] });
  });

  it("a blank offer box leaves every saved offer untouched (#1401)", async () => {
    mocks.current.mockResolvedValue({ data: { offers: ["Free survey", "10% off"] }, error: null });
    mocks.written.mockResolvedValue({ data: { id: "b1", name: complete.name, vertical: complete.vertical, phone: complete.phone, locations: ["Jaipur"], offers: ["Free survey", "10% off"] }, error: null });
    const { saveSetupBusiness } = await import("@/app/(app)/brand/actions");
    await saveSetupBusiness("b1", { ...complete, offer: "  " });
    await saveSetupBusiness("b1", { ...complete, offer: "" });
    for (const [payload] of mocks.update.mock.calls) expect(payload).not.toHaveProperty("offers");
    await saveSetupBusiness("b1", { ...complete, offer: "Free visit" });
    expect(mocks.update.mock.calls.at(-1)![0].offers).toEqual(["Free visit", "10% off"]);
  });

  it("creates the business on the first save with a name; not before", async () => {
    const { saveSetupBusiness } = await import("@/app/(app)/brand/actions");
    await expect(saveSetupBusiness(null, { ...complete, name: " " })).resolves.toEqual({ ok: false, error: "Add your business name." });
    expect(mocks.insert).not.toHaveBeenCalled();
    mocks.written.mockResolvedValue({ data: { id: "b2", name: "SunPeak Solar", vertical: "local business", phone: null, locations: [], offers: [] }, error: null });
    await expect(saveSetupBusiness(null, { name: "SunPeak Solar", vertical: "", locations: "", offer: "", phone: "" })).resolves.toEqual({ ok: true, id: "b2", usable: false });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: "u1", name: "SunPeak Solar", locations: [], offers: [] }));
  });

  it("refuses when signed out", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const { saveSetupBusiness } = await import("@/app/(app)/brand/actions");
    await expect(saveSetupBusiness("b1", complete)).resolves.toEqual({ ok: false, error: "Not authenticated." });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("#1966: saves the owner's first USP without replacing their other facts", async () => {
    mocks.current.mockResolvedValue({ data: { offers: ["Old offer"], usps: ["Old fact", "Local installation team"] }, error: null });
    mocks.written.mockResolvedValue({ data: { id: "b1", ...complete, locations: ["Jaipur"], offers: [complete.offer] }, error: null });
    const { saveSetupBusiness } = await import("@/app/(app)/brand/actions");
    await expect(saveSetupBusiness("b1", { ...complete, usp: "  80 homes installed in Mohali  " }))
      .resolves.toMatchObject({ ok: true });
    expect(mocks.update.mock.calls.at(-1)![0].usps).toEqual(["80 homes installed in Mohali", "Local installation team"]);
  });

  it("#1966: rejects unresolved or truncated chip blanks before writing", async () => {
    const { saveSetupBusiness } = await import("@/app/(app)/brand/actions");
    for (const usp of ["{n} homes installed in {area}", "80 homes installed in {area", "}".padStart(301, "a")]) {
      await expect(saveSetupBusiness("b1", { ...complete, usp })).resolves.toMatchObject({ ok: false });
    }
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("#1966: includes a completed fact when the first save creates the business", async () => {
    mocks.written.mockResolvedValue({ data: { id: "b2", ...complete, locations: ["Jaipur"], offers: [complete.offer] }, error: null });
    const { saveSetupBusiness } = await import("@/app/(app)/brand/actions");
    await saveSetupBusiness(null, { ...complete, usp: "Our own installation team, no subcontractors" });
    expect(mocks.insert.mock.calls.at(-1)![0].usps).toEqual(["Our own installation team, no subcontractors"]);
  });

  it("#1966: doesn't truncate a longer existing Brand fact or block saving its other fields", async () => {
    const usp = `${"Our own installation team. ".repeat(14)}No subcontractors.`;
    mocks.current.mockResolvedValue({ data: { offers: [], usps: [usp] }, error: null });
    mocks.written.mockResolvedValue({ data: { id: "b1", ...complete, locations: ["Jaipur"], offers: [] }, error: null });
    const { saveSetupBusiness } = await import("@/app/(app)/brand/actions");
    await expect(saveSetupBusiness("b1", { ...complete, usp })).resolves.toMatchObject({ ok: true });
    expect(mocks.update.mock.calls.at(-1)![0].usps).toEqual([usp]);
  });

  it("#1966: an omitted or empty optional fact leaves saved facts untouched", async () => {
    mocks.current.mockResolvedValue({ data: { offers: [], usps: ["Our own team", "Local workshop"] }, error: null });
    mocks.written.mockResolvedValue({ data: { id: "b1", ...complete, locations: ["Jaipur"], offers: [] }, error: null });
    const { saveSetupBusiness } = await import("@/app/(app)/brand/actions");
    await saveSetupBusiness("b1", complete);
    await saveSetupBusiness("b1", { ...complete, usp: " " });
    for (const [payload] of mocks.update.mock.calls) expect(payload).not.toHaveProperty("usps");
  });
});

describe("core: <SetupBusinessStep> (#1269)", () => {
  const business = { id: "b1", name: "SunPeak Solar", vertical: "local business", locations: [], offers: [], phone: null, website: null } as unknown as Business;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("@/app/(app)/brand/actions", () => ({ saveSetupBusiness: mocks.saveSetupBusiness, saveAdLanguage: mocks.saveAdLanguage }));
    mocks.saveSetupBusiness.mockImplementation(async (id: string | null) => ({ ok: true, id: id ?? "b-new", usable: true }));
  });

  async function step(initial: Business | null = business, chooseLanguage = false) {
    const { SetupBusinessStep } = await import("@/components/setup-business-step");
    render(<SetupBusinessStep business={initial} chooseLanguage={chooseLanguage} />);
  }
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const makeMyAds = () => within(screen.getByRole("navigation", { name: "Setup steps" })).getByRole("button", { name: "Make my ads" });

  it("#1934: returning mode asks only for the new offer (last one as placeholder); the rest folds into 'Same as last time'", async () => {
    const launched = { ...business, vertical: "Rooftop solar", locations: ["Mohali", "Kharar"], offers: ["Diwali 10% off"], phone: "9876543210" } as unknown as Business;
    const { SetupBusinessStep } = await import("@/components/setup-business-step");
    render(<SetupBusinessStep business={launched} returning />);
    expect(screen.getByRole("heading", { name: "What's new this time?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your offer")).toHaveValue("");
    expect(screen.getByLabelText("Your offer")).toHaveAttribute("placeholder", "Diwali 10% off");
    for (const label of ["Business name", "What you sell", "Where you serve", "WhatsApp number"]) expect(screen.queryByLabelText(label)).toBeNull();
    expect(screen.getByText(/Same as last time: Rooftop solar · Mohali, Kharar · 9876543210\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fill it from my website/ })).toBeNull();
    // Nothing typed: it stays and says what's missing.
    await act(async () => fireEvent.click(makeMyAds()));
    expect(screen.getByText("Add one offer, like a free visit or a first-time price.")).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    type("Your offer", "Free site survey this week");
    await act(async () => fireEvent.click(makeMyAds()));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/create?again=1"));
    expect(mocks.saveSetupBusiness.mock.calls.at(-1)![1]).toMatchObject({ offer: "Free site survey this week", vertical: "Rooftop solar" });
  });

  it("#1934: 'Change' opens the folded fields", async () => {
    const launched = { ...business, vertical: "Rooftop solar", locations: ["Mohali"], offers: ["Diwali 10% off"], phone: "9876543210" } as unknown as Business;
    const { SetupBusinessStep } = await import("@/components/setup-business-step");
    render(<SetupBusinessStep business={launched} returning />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText("Where you serve")).toHaveValue("Mohali");
    expect(screen.queryByText(/Same as last time/)).toBeNull();
  });

  it("#1853: after हिंदी, the note stays for this visit even when the cookie's re-render turns the offer off", async () => {
    const setAppLanguage = vi.fn(async () => ({ ok: true }));
    vi.doMock("@/app/(app)/settings/language-actions", () => ({ setAppLanguage }));
    const { SetupBusinessStep } = await import("@/components/setup-business-step");
    const { rerender } = render(<SetupBusinessStep business={business} chooseLanguage />);
    fireEvent.click(within(screen.getByRole("group", { name: "App language / ऐप की भाषा" })).getByRole("button", { name: "हिंदी" }));
    await waitFor(() => expect(setAppLanguage).toHaveBeenCalledWith("hi"));
    // The server action sets the cookie and the route re-renders with chooseLanguage false.
    rerender(<SetupBusinessStep business={business} chooseLanguage={false} />);
    expect(await screen.findByText("अभी सिर्फ़ होम हिंदी में है; बाकी स्क्रीन एक-एक करके जुड़ेंगी।")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "App language / ऐप की भाषा" })).toBeNull();
  });

  it("#1641: offers English / हिंदी only until a language is chosen", async () => {
    vi.doMock("@/app/(app)/settings/language-actions", () => ({ setAppLanguage: vi.fn(async () => ({ ok: true })) }));
    await step(business, true);
    expect(screen.getByRole("group", { name: "App language / ऐप की भाषा" })).toBeInTheDocument();
    cleanup();
    await step(business, false);
    expect(screen.queryByRole("group", { name: "App language / ऐप की भाषा" })).toBeNull();
  });

  it("#1681: 'Ads in' follows what they sell (solar → Hinglish); a picked language is saved before step 2", async () => {
    await step();
    type("What you sell", "Rooftop solar");
    expect(screen.getByRole("button", { name: "Hinglish" })).toHaveAttribute("aria-pressed", "true");
    type("What you sell", "Modular kitchens");
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "ਪੰਜਾਬੀ" }));
    type("Where you serve", complete.locations);
    type("Your offer", complete.offer);
    type("WhatsApp number", complete.phone);
    await act(async () => fireEvent.click(makeMyAds()));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/create"));
    expect(mocks.saveAdLanguage).toHaveBeenCalledWith("b1", "pa");
  });

  it("is step 1 of 3 with the five fields, no Back, and the free note", async () => {
    await step();
    expect(screen.getByRole("group", { name: "Step 1 of 3: Your business" })).toBeInTheDocument();
    for (const label of ["Business name", "What you sell", "Where you serve", "Your offer", "WhatsApp number"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByText("Making ads is included. Nothing goes live until you say so.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "More about your business" })).toHaveAttribute("href", "/brand?all=1");
    // #1570 (CPO, #1438): the pilots are in Tricity, so the example places are too.
    expect(screen.getByLabelText("Where you serve")).toHaveAttribute("placeholder", "e.g. Mohali\nKharar");
  });

  it("#1966: no claim is prefilled; a chip focuses and selects its first blank", async () => {
    await step({ ...business, vertical: "Rooftop solar" });
    const field = screen.getByLabelText("Why do customers pick you? (optional)") as HTMLInputElement;
    expect(field).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Registered PM Surya Ghar vendor" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "{n} homes installed in {area}" }));
    expect(field).toHaveValue("{n} homes installed in {area}");
    expect(field).toHaveFocus();
    expect(field.value.slice(field.selectionStart!, field.selectionEnd!)).toBe("{n}");
    type("What you sell", "IELTS coaching");
    expect(screen.getByRole("button", { name: "Batches of at most {n} students" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "{n} homes installed in {area}" })).toBeNull();
    type("What you sell", "Modular kitchens");
    expect(screen.getByRole("button", { name: "Our own workshop in {area}" })).toBeInTheDocument();
    type("What you sell", "Bakery");
    expect(screen.queryByRole("button", { name: "Our own workshop in {area}" })).toBeNull();
    expect(field).toHaveAttribute("placeholder", "e.g. Same-day visits in Mohali");
  });

  it("#1966: incomplete blanks never autosave or reach Create; completed text does", async () => {
    await step({ ...business, vertical: complete.vertical, locations: ["Jaipur"], offers: [complete.offer], phone: complete.phone });
    fireEvent.click(screen.getByRole("button", { name: "{n} homes installed in {area}" }));
    await waitFor(() => expect(screen.getByLabelText("Why do customers pick you? (optional)")).toHaveAttribute("aria-invalid", "true"), { timeout: 2000 });
    await act(async () => fireEvent.click(makeMyAds()));
    expect(mocks.saveSetupBusiness).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    type("Why do customers pick you? (optional)", "80 homes installed in Mohali");
    await act(async () => fireEvent.click(makeMyAds()));
    expect(mocks.saveSetupBusiness.mock.calls.at(-1)![1]).toMatchObject({ usp: "80 homes installed in Mohali" });
    expect(mocks.push).toHaveBeenCalledWith("/create");
  });

  it("#1966: reads a saved first fact and translates the field and chips in Hindi", async () => {
    const hi = await import("../../messages/hi.json");
    const { SetupBusinessStep } = await import("@/components/setup-business-step");
    render(<SetupBusinessStep business={{ ...business, vertical: "IELTS coaching", usps: ["Evening batches"] }} words={{ locale: "hi", messages: hi.setup }} />);
    const field = screen.getByLabelText("ग्राहक आपको क्यों चुनते हैं? (ज़रूरी नहीं)");
    expect(field).toHaveValue("Evening batches");
    fireEvent.click(screen.getByRole("button", { name: "एक बैच में ज़्यादा से ज़्यादा {n} छात्र" }));
    expect(field).toHaveValue("एक बैच में ज़्यादा से ज़्यादा {n} छात्र");
  });

  it("completing the five fields saves them (brandUsable) and goes to Your ads", async () => {
    await step();
    type("What you sell", complete.vertical);
    type("Where you serve", complete.locations);
    type("Your offer", complete.offer);
    type("WhatsApp number", complete.phone);
    await act(async () => fireEvent.click(makeMyAds()));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/create"));
    const [id, saved] = mocks.saveSetupBusiness.mock.calls.at(-1)!;
    expect(id).toBe("b1");
    expect(saved).toEqual({ ...complete, usp: "" });
    expect(brandUsable({ ...saved, locations: setupLocations(saved.locations), offers: [saved.offer] })).toBe(true);
  });

  it("an incomplete step says what's missing and stays", async () => {
    await step();
    await act(async () => fireEvent.click(makeMyAds()));
    expect(screen.getByText("Say what you sell, in a few words.")).toBeInTheDocument();
    expect(screen.getByText("Enter a 10-digit mobile number.")).toBeInTheDocument();
    expect(screen.getByLabelText("What you sell")).toHaveFocus();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("the service area is required (#1136 CEO): everything else filled, no area → stays on step 1", async () => {
    await step();
    type("What you sell", complete.vertical);
    type("Where you serve", " \n ");
    type("Your offer", complete.offer);
    type("WhatsApp number", complete.phone);
    await act(async () => fireEvent.click(makeMyAds()));
    expect(screen.getByText("Add at least one city or area.")).toBeInTheDocument();
    expect(screen.getByLabelText("Where you serve")).toHaveFocus();
    expect(screen.getByLabelText("Where you serve")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("saves as they type and says Saved", async () => {
    await step();
    type("Your offer", "Free site survey");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"), { timeout: 2000 });
    expect(mocks.saveSetupBusiness).toHaveBeenCalledWith("b1", expect.objectContaining({ offer: "Free site survey" }));
  });

  it("a failed save says so and keeps the owner here", async () => {
    mocks.saveSetupBusiness.mockResolvedValue({ ok: false, error: "offline" });
    await step({ ...business, vertical: complete.vertical, locations: ["Jaipur"], offers: ["Free site survey"], phone: complete.phone } as Business);
    await act(async () => fireEvent.click(makeMyAds()));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Not saved. Check your connection."));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("Fill it from my website fills only the empty fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ extraction: { vertical: "Solar panels", locations: ["Jaipur"], offers: ["Free survey"], phone: "9876543210", name: "Solaride" } })));
    await step();
    type("Your offer", "My own offer");
    type("Your website (optional)", "sunpeak.in");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Fill it from my website" })));
    expect(await screen.findByText("Filled from your website. Check each line.")).toBeInTheDocument();
    expect(screen.getByLabelText("What you sell")).toHaveValue("Solar panels");
    expect(screen.getByLabelText("Your offer")).toHaveValue("My own offer");
    expect(screen.getByLabelText("WhatsApp number")).toHaveValue("9876543210");
    // #1379: the owner's name stays; an empty one is filled (the pasted-bio test below).
    expect(screen.getByLabelText("Business name")).toHaveValue("SunPeak Solar");
  });

  // #1317 (QA 2's #1365 walk): a bio-only prospect fills step 1 from pasted text, with no trip to the full Brand page.
  it("No website? fills only the empty fields from a pasted bio, and says where they came from", async () => {
    const fetch = vi.fn(async () => Response.json({ extraction: { name: "Sweet Crumbs Bakery", vertical: "Eggless cakes", locations: ["Mohali"], phone: "+919829012345" } }));
    vi.stubGlobal("fetch", fetch);
    await step({ ...business, name: "" } as Business);
    type("Your offer", "Free delivery");
    fireEvent.click(screen.getByRole("button", { name: "No website? Paste a bio or listing" }));
    const fill = screen.getByRole("button", { name: "Fill from this text" });
    expect(fill).toBeDisabled();
    type("Instagram bio, Google listing or catalogue text", "Sweet Crumbs Bakery 🍰 Mohali Phase 7 | Eggless cakes | WhatsApp 98290 12345");
    await act(async () => fireEvent.click(fill));
    expect(await screen.findByText("Filled from your text. Check each line.")).toBeInTheDocument();
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ text: "Sweet Crumbs Bakery 🍰 Mohali Phase 7 | Eggless cakes | WhatsApp 98290 12345" });
    expect(screen.getByLabelText("Business name")).toHaveValue("Sweet Crumbs Bakery");
    expect(screen.getByLabelText("What you sell")).toHaveValue("Eggless cakes");
    expect(screen.getByLabelText("Your offer")).toHaveValue("Free delivery");
  });

  it("pasted text too short to read gets the server's own words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Paste a little more about the business: what it sells, where, and how to reach it." }, { status: 400 })));
    await step();
    fireEvent.click(screen.getByRole("button", { name: "No website? Paste a bio or listing" }));
    type("Instagram bio, Google listing or catalogue text", "Cakes!");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Fill from this text" })));
    expect(await screen.findByText("Paste a little more about the business: what it sells, where, and how to reach it.")).toBeInTheDocument();
  });

  it("a website it can't read says so plainly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "blocked" }, { status: 422 })));
    await step();
    type("Your website (optional)", "sunpeak.in");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Fill it from my website" })));
    expect(await screen.findByText("We couldn't read that website. Fill it in yourself; it takes about a minute.")).toBeInTheDocument();
  });
});
