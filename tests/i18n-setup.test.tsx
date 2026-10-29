// @vitest-environment jsdom
// #1438 WS1 slice: the first-ad setup in the owner's app language (CPO's #1251 tables + #1707). English is unchanged.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SetupBusinessStep } from "@/components/setup-business-step";
import { SetupResumeCard } from "@/components/setup-resume-card";
import { namespaceMessages } from "@/i18n/locale";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/brand/actions", () => ({ saveSetupBusiness: vi.fn(async () => ({ ok: true, id: "b" })), saveAdLanguage: vi.fn() }));
vi.mock("@/app/(app)/settings/language-actions", () => ({ setAppLanguage: vi.fn() }));

const hindi = { locale: "hi" as const, messages: namespaceMessages("hi", "setup") };

describe("WS1 step 1 in Hindi", () => {
  it("frame, title, fields and the primary read in Hindi", () => {
    render(<SetupBusinessStep business={null} words={hindi} />);
    expect(screen.getByRole("heading", { name: "अपना पहला विज्ञापन सेट करें" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "चरण 1 / 3: आपका बिज़नेस" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "अपने बिज़नेस के बारे में बताइए" })).toBeInTheDocument();
    expect(screen.getByLabelText("बिज़नेस का नाम")).toBeInTheDocument();
    expect(screen.getByLabelText("आप कहाँ सर्विस देते हैं")).toHaveAttribute("placeholder", "जैसे मोहाली\nखरड़");
    expect(screen.getByText("आपके विज्ञापन सिर्फ़ यहीं दिखेंगे। हर लाइन में एक शहर या इलाका।")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "वेबसाइट नहीं है? बायो या लिस्टिंग पेस्ट करें" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "मेरे विज्ञापन बनाइए" })).toBeInTheDocument();
    // #2046: the ad-language field was the one English label left on Hindi step 1.
    expect(screen.getByRole("group", { name: "आपके विज्ञापन इस भाषा में होंगे" })).toBeInTheDocument();
    expect(document.querySelector("[lang='hi'] h1")).not.toBeNull();
  });

  it("says what's missing in Hindi", async () => {
    render(<SetupBusinessStep business={null} words={hindi} />);
    fireEvent.click(screen.getByRole("button", { name: "मेरे विज्ञापन बनाइए" }));
    expect(await screen.findByText("बिज़नेस का नाम लिखें।")).toBeInTheDocument();
    expect(screen.getByText("10 अंकों का मोबाइल नंबर लिखें।")).toBeInTheDocument();
  });

  it("the website note reads in Hindi", () => {
    render(<SetupBusinessStep business={null} words={hindi} />);
    fireEvent.click(screen.getByRole("button", { name: /मेरी वेबसाइट से भरें/ }));
    expect(screen.getByText("पहले अपनी वेबसाइट लिखें, जैसे yourbusiness.com।")).toBeInTheDocument();
  });

  it("stays in English without a choice", () => {
    render(<SetupBusinessStep business={null} />);
    expect(screen.getByRole("heading", { name: "Tell us about your business" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make my ads" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Your ads will be in" })).toBeInTheDocument();
    // The ad-language chip 'हिंदी' carries its own lang; the step itself doesn't.
    expect(document.querySelector("[lang='hi'] h1")).toBeNull();
  });
});

describe("Home's first-ad card in Hindi", () => {
  it("steps 1–2: the step line and Continue", () => {
    render(<SetupResumeCard step={1} locale="hi" />);
    expect(screen.getByRole("heading", { name: "आपका पहला विज्ञापन" })).toBeInTheDocument();
    expect(screen.getByText("चरण 1 / 3 · आपका बिज़नेस")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "जारी रखें" })).toBeInTheDocument();
  });

  it("step 3 with ready ads: one and many, the next-step line and the button", () => {
    const ad = (id: string) => ({ id, headline: null, image_url: `https://x.supabase.co/${id}.png` });
    const { unmount } = render(<SetupResumeCard step={3} ready={[ad("a"), ad("b")]} locale="hi" />);
    expect(screen.getByRole("heading", { name: "आपके 2 विज्ञापन तैयार हैं" })).toBeInTheDocument();
    expect(screen.getByText("अब: अपना Facebook पेज जोड़ें और लाइव करें। लगभग 10 मिनट लगते हैं, और लाइव करें दबाने तक कोई खर्च नहीं होता।")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "पेज जोड़ें और लाइव करें" })).toBeInTheDocument();
    unmount();
    render(<SetupResumeCard step={3} ready={[ad("a")]} locale="hi" />);
    expect(screen.getByRole("heading", { name: "आपका विज्ञापन तैयार है" })).toBeInTheDocument();
  });
});
