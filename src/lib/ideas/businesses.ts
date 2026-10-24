import type { BrandContext } from "@/lib/templates/ads";

/**
 * Example local businesses for the /ideas gallery (#289). They are not real customers: the
 * ads are real AdBrain output for these briefs. No phone numbers or websites, evergreen offers only.
 */
export type IdeaBusiness = { slug: string; industry: string; title: string; goal: string; brand: BrandContext };

export const IDEA_BUSINESSES: IdeaBusiness[] = [
  {
    slug: "rooftop-solar", industry: "Rooftop solar", title: "Rooftop solar installer",
    goal: "Get homeowners nearby to message us on WhatsApp to book a free site survey for rooftop solar.",
    brand: { name: "SunPeak Solar", vertical: "rooftop solar installer", description: "Installs rooftop solar for homes and small businesses, from site survey to net metering.", target_audience: "Homeowners with high electricity bills", usps: ["Free site survey before any quote", "Help with PM Surya Ghar subsidy paperwork", "Local installation team"], offers: ["Free site survey"], locations: ["Jaipur"], primary_color: "#1d4e3a", languages: ["English"] },
  },
  {
    slug: "dental-clinic", industry: "Clinic", title: "Family dental clinic",
    goal: "Get families nearby to message us on WhatsApp to book a dental check-up.",
    brand: { name: "Smile Studio Dental", vertical: "dental clinic", description: "A family dental clinic for check-ups, cleaning, fillings and braces.", target_audience: "Parents and working adults who have put off a dental visit", usps: ["Evening and Sunday appointments", "Gentle care for children"], offers: ["Check-up and cleaning for ₹499"], locations: ["Pune"], primary_color: "#0f5c78", languages: ["English"] },
  },
  {
    slug: "hair-salon", industry: "Salon", title: "Neighbourhood hair salon",
    goal: "Get women nearby to message us on WhatsApp to book a haircut or hair spa.",
    brand: { name: "Mirror & Comb Salon", vertical: "hair and beauty salon", description: "Haircuts, colour and hair spa in a calm neighbourhood studio.", target_audience: "Women who want a reliable salon close to home", usps: ["Appointments on WhatsApp", "Trained stylists for colour and cuts"], offers: ["Hair spa at ₹799"], locations: ["Indore"], primary_color: "#7a2e4d", languages: ["English"] },
  },
  {
    slug: "gym", industry: "Gym", title: "Neighbourhood gym",
    goal: "Get people nearby to message us on WhatsApp to book a free trial workout.",
    brand: { name: "IronWorks Fitness", vertical: "gym and fitness studio", description: "Strength and cardio gym with personal training and small-group classes.", target_audience: "Beginners and busy professionals who want to get fit near home", usps: ["Trainers on the floor at all hours", "Beginner-friendly plans"], offers: ["Free trial workout"], locations: ["Ludhiana"], primary_color: "#2b2b2b", languages: ["English"] },
  },
  {
    slug: "coaching-institute", industry: "Coaching", title: "Coaching institute",
    goal: "Get parents of class 9 to 12 students to message us on WhatsApp to book a free demo class.",
    brand: { name: "Pathshala Academy", vertical: "coaching institute", description: "Maths and science coaching for classes 9 to 12 in small batches.", target_audience: "Parents of school students preparing for board exams", usps: ["Batches of at most 20 students", "Weekly tests with progress reports for parents"], offers: ["Free demo class"], locations: ["Lucknow"], primary_color: "#23407a", languages: ["English"] },
  },
  {
    slug: "restaurant", industry: "Restaurant", title: "Family restaurant",
    goal: "Get families nearby to message us on WhatsApp to reserve a table for the weekend.",
    brand: { name: "Tadka House", vertical: "family restaurant", description: "North Indian family restaurant serving thalis, tandoor and home-style curries.", target_audience: "Families looking for a weekend meal out", usps: ["Family seating for groups", "Fresh tandoor every evening"], offers: ["Weekend family thali"], locations: ["Chandigarh"], primary_color: "#8a3a12", languages: ["English"] },
  },
  {
    slug: "real-estate", industry: "Real estate", title: "Local property advisor",
    goal: "Get people looking for a 2 or 3 BHK flat to message us on WhatsApp to arrange a site visit.",
    brand: { name: "Keystone Homes", vertical: "real estate agency", description: "Helps families buy and rent 2 and 3 BHK flats in the city.", target_audience: "Families looking to buy or rent their next home", usps: ["Site visits arranged on your schedule", "Help with home-loan paperwork"], offers: ["Free site visit"], locations: ["Noida"], primary_color: "#3b4a5c", languages: ["English"] },
  },
  {
    slug: "boutique", industry: "Boutique", title: "Ethnic wear boutique",
    goal: "Get women nearby to message us on WhatsApp to see this season's suits and sarees.",
    brand: { name: "Gulmohar Boutique", vertical: "ethnic wear boutique", description: "Hand-picked suits, sarees and dupattas, with tailoring in the store.", target_audience: "Women shopping for festive and everyday ethnic wear", usps: ["Tailoring and fitting in the store", "New designs every month"], offers: ["Free fitting with every suit"], locations: ["Amritsar"], primary_color: "#9c2f2f", languages: ["English"] },
  },
  {
    slug: "physiotherapy", industry: "Clinic", title: "Physiotherapy clinic",
    goal: "Get people with back or knee pain to message us on WhatsApp to book a first assessment.",
    brand: { name: "MoveWell Physio", vertical: "physiotherapy clinic", description: "Physiotherapy for back, neck and knee pain, and sports injuries.", target_audience: "Adults with back, neck or knee pain", usps: ["One-on-one sessions with a physiotherapist", "Home visits available"], offers: ["First assessment at ₹300"], locations: ["Hisar"], primary_color: "#1f6f6b", languages: ["English"] },
  },
  {
    slug: "bakery", industry: "Bakery", title: "Neighbourhood bakery",
    goal: "Get people nearby to message us on WhatsApp to order a custom birthday cake.",
    brand: { name: "Crumb & Co. Bakery", vertical: "bakery and cake shop", description: "Fresh breads, pastries and custom cakes baked every morning.", target_audience: "Families planning birthdays and celebrations", usps: ["Eggless cakes on request", "Custom designs for birthdays"], offers: ["Order a custom cake on WhatsApp"], locations: ["Bhopal"], primary_color: "#6b3e26", languages: ["English"] },
  },
];
