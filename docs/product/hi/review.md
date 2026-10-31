# जाँचें और लाइव करें
<!-- mirrors ../review.md 800808cc9745 -->

यह [Review and Go Live](../review.md) का हिंदी रूप है; अंग्रेज़ी पेज बदले तो इसे भी बदलें।
[Features and workflows](../README.md) का हिस्सा।
[Prepare a Campaign](../launch.md#prepare-a-campaign) का एक step।

### जाँचें, बनाएँ, चालू करें

पहली बार आने वाले को, जिसके ads approve हो चुके हैं, अभी कोई campaign नहीं है, और जो
Meta जोड़ सकता है, `/campaigns` पर setup का step 3 "Go live" मिलता है (#1251 WS1, #1271;
हिंदी में भी, #1438): चुने हुए ads, एक daily budget (₹300/₹500/₹1,000 रोज़) 2 दिन
(default) या 7 दिन के लिए (#1530: pilots, ₹300 पर ज़्यादा से ज़्यादा ₹2,478), और Meta का
GST मिलाकर यह ज़्यादा से ज़्यादा कितना खर्च कर सकता है (`capWithGstPaise`, वही formula जो
activation reserve खुद इस्तेमाल करता है), इलाके, WhatsApp chat और उसके साथ Go live जो
welcome message भेजता है (#1529: `setupWelcome`, Go live के draft पर Review का अपना
`campaignWhatsAppMessage`, यानी saved message या AdBrain वाला), Page जुड़ने के बाद "Change
who sees it" (पूरा composer), और weekly cap की line (#1342; cap से ऊपर हो तो Go live पर tap
नहीं हो सकता)। Checklist में Facebook Page, पैसे वाली row (payment मालिक के अपने Meta
account पर होता है; AdBrain ad money वाली row हर funding mode में छिपी रहती है, जब तक
pass-through ad money के साथ flat ₹999/month pricing नहीं आती, #1251 CEO) और "Stops at"
total दिखते हैं।
एक ही primary button पहले Page जोड़ता है (MetaConnectDialog), फिर "Go live · ₹{d} a
day" एक tap का काम है (#1271 4b, `src/lib/campaign/setup-go-live-flow.ts`), उन्हीं routes से
जो Campaigns page इस्तेमाल करता है: connection status (जुड़ा नहीं → Meta dialog),
composer का default draft save करना (चुने हुए ads, ₹d रोज़, WhatsApp Meta के पहले ready
number पर, default targeting, कोई A/B नहीं), preflight, उसे PAUSED बनाना (operation को poll
किया जाता है), फिर `GET /api/campaigns/{id}` और उसे `PATCH` करके चुने हुए दिनों के capped run
के रूप में active करना (`capDays: 2` या `7`, ताकि Meta की कुल limit ₹d×दिन हो; server weekly
cap और funding भी जाँचता है)। हर step की progress की एक line। Review के blockers अपने ही
शब्दों में "Fix in campaign review" के साथ दिखते हैं
(`?all=1&new=1&review=1&budget=d&creatives=…`) और कुछ नहीं बनता; activation मना हो जाए तो
वह जैसा का तैसा दिखाया जाता है और campaign paused रहता है, कुछ खर्च नहीं होता।
जब Meta चालू नहीं कर पाता क्योंकि ad account में payment का कोई तरीका नहीं है
(`BILLING_REQUIRED`, #1990), तो step 3 Meta के text की जगह मालिक की भाषा में बताता है: "Meta
needs a way to pay first: a card, or money added by UPI or net banking. Add it in Meta, then
tap Go live again. Nothing was spent.", साथ में "Add payment in Meta" (Meta की payment
settings); "Fix in campaign review" तभी दिखता है जब दूसरे blockers बचे हों। Payment row का
"Add a card, or pay by UPI or net banking" समझाता है कि card से Meta ads चलने के बाद पैसा
काटता है, जबकि UPI या net banking का पैसा पहले जोड़ना होता है, कम से कम run के total जितना,
वरना पैसा खत्म होते ही ads रुक जाते हैं।
Create request (idempotency key) हर business, ads और budget के लिए sessionStorage में रखी जाती
है, ताकि दूसरा tap या reload नया campaign बनाने की जगह उसी operation को आगे बढ़ाए
(`operationForRequest`)।

Composer (More options) बंद करने पर उसका unsaved brief, creatives, audience, destination और
budget मौजूदा business के लिए memory में रहते हैं; उसी mounted view में किसी business पर लौटने
पर उसका अपना setup वापस आ जाता है। इसे साफ़ करने के लिए **Discard and start new** इस्तेमाल करें,
जो पहले confirm करवाता है। Unsaved बदलाव reload/navigation के बाद नहीं बचते: server पर
recovery के लिए Save draft इस्तेमाल करें। Pending या अनिश्चित creation operation को discard
करके उसकी recovery identity से बचा नहीं जा सकता; local setup साफ़ करने के बाद भी saved drafts
मिलते रहते हैं।

Preflight ownership, approved creative content, active lead form, connection capability, INR
currency, resolved targeting और budget जाँचता है। Health, education और solar/interiors businesses के
लिए यह हर ad की saved wording को Create के banned-claim rule से भी पढ़ता है (सिर्फ़ पूरे शब्द), ताकि
मालिक का बदला हुआ "Cures back pain" या "Guaranteed savings" Meta तक पहुँचने से पहले रुक जाए
(`REVIEW_AD_POLICY`, #739, #2423)। Launch जो WhatsApp welcome, pre-typed message और quick questions
भेजेगा (suggested, saved या edited), उन पर भी यही rule और #738 के policy rules लगते हैं, और blocker
field का नाम बताता है (`REVIEW_WHATSAPP_MESSAGE`, #2422)। इसका hash
review किए गए inputs, चुने हुए assets, resolved IDs और creative content को बाँधता है। Creation
preflight दोबारा चलाता है और पुराना (stale) draft, hash या connection generation ठुकरा देता है।
हर Review blocker अपने message के नीचे एक-tap fix दिखाता है (`reviewBlockerFix`, #723): यह
Brand Brain खोलता है (website, WhatsApp), Connect Facebook खोलता है (connection नहीं,
currency, access), या composer के उस control पर ले जाकर उसे focus करता है (ads, lead form,
budget, age, radius, locations, Recommend audience, interests)। Website वाला blocker **Use
WhatsApp chat instead** भी देता है, क्योंकि chat ads को website नहीं चाहिए (#742)। Fix के बाद,
blocked review में **Check again** उसी जगह Review दोबारा चलाता है (#756)। अधूरा होने पर भी
Prepare पर tap हो सकता है: कोई ad या budget न हो तो यह उस control के पास बताता है और उसे focus
करता है (#772)।

Durable creation operation एक idempotency key इस्तेमाल करता है और external IDs के checkpoints
रखता है। अनिश्चितता के बाद उसे poll करें; pending या `needs_reconciliation` state से निकलने के
लिए नई key submit न करें। Optional worker mode वही operation queue करता है और queue उपलब्ध न हो
तो inline execution पर वापस नहीं जाता। बना हुआ campaign paused रहता है। Activation के लिए नया
confirmation digest, connection की दोबारा जाँच, provider verification और spend guardrail check
ज़रूरी हैं। Creation की idempotency activation या paid generation पर लागू नहीं होती। Payloads
और states के लिए [API Reference](../../api/README.md) देखें।

Pause और delete भी account/Page binding जाँचते हैं। पुरानी (legacy) binding न हो तो reconciliation
चाहिए, अंदाज़ा नहीं। Meta writes और local mirrors atomic नहीं हैं: provider action सफल हो सकता है
जबकि उसके बाद का database write fail हो जाए। Record रखें और जाँच करें; HTTP failure को इस बात का
सबूत न मानें कि remote पर कोई असर नहीं हुआ।

## जब Review आपको रोके

Review हर रुकावट का एक message दिखाता है और उसके नीचे एक fix button (`src/lib/campaign/preflight.ts`,
`review-fix.ts`)। ये messages और buttons app में अंग्रेज़ी में ही दिखते हैं, इसलिए नीचे वही शब्द हैं।
Button दबाएँ, वह एक चीज़ ठीक करें, फिर **Check again** दबाएँ। `{braces}` वाले शब्दों की जगह वह ad,
इलाका या interest आता है जिसका नाम Meta ने लिया। Support पूरी पंक्ति का message और "क्या करें" भेज सकता है।

| Code | Review का message | Fix button | क्या करें |
| --- | --- | --- | --- |
| `REVIEW_NO_META_CONNECTION` | "Connect Facebook and choose your Page and ad account." | "Connect Facebook" | Facebook जोड़ें, फिर इस business का Page और ad account चुनें। |
| `REVIEW_CURRENCY` | "Choose an ad account that pays in Indian rupees (INR)." | "Choose another ad account" | रुपये वाला ad account चुनें। Meta account की currency नहीं बदलता, इसलिए INR वाला न हो तो नया बनाएँ। |
| `REVIEW_META_ACCESS` | "Meta hasn't confirmed AdBrain can create campaigns in this ad account. Connect Facebook again and allow every permission it asks for." | "Connect Facebook again" | दोबारा जोड़ें और हर permission चालू रहने दें। |
| `REVIEW_CREATIVES` | "Choose at least one ad to send to Meta.", "One of the ads you chose isn't available any more. Choose your ads again.", या कोई ad जो "isn't approved yet", "has no picture yet" या "has no headline" | "Choose your ads" (ad picker खुलता है) | ऐसे approved ads चुनें जिनमें picture और headline हो। |
| `REVIEW_WHATSAPP_NOT_LINKED` | "Your Facebook Page has no WhatsApp number linked yet, so the ad's button has nowhere to open a chat. Link the number in Settings, then review again." | "Link your WhatsApp number" (Settings खुलता है) | Meta में WhatsApp Business number को Page से जोड़ें, फिर Settings में जाँचें। |
| `REVIEW_WHATSAPP_MESSAGE` | "Your WhatsApp message: {problem}" | "Edit the WhatsApp message" | Message में जो कमी बताई है (बहुत लंबा, खाली, या welcome, pre-typed message या किसी question में कोई वादा) उसे ठीक करें। |
| `REVIEW_NO_LEAD_FORM` | "Choose an active lead form from your Facebook Page in the Lead form field." | "Choose a lead form" | Active form चुनें, या पहले Facebook Page पर एक बनाएँ। |
| `REVIEW_NO_WEBSITE` | "Add your business website on the Your business page. Meta lead ads must link to the advertiser's own website, not Facebook." | "Add your website" (Brand खुलता है), या "Use WhatsApp chat instead (no website needed)" | अपनी website डालें, या WhatsApp chat ads पर जाएँ। |
| `REVIEW_AD_POLICY` | ad में "{word}" is a health promise (clinics) या a promise (बाकी) "Meta rejects. Edit the ad to describe the service instead." | "Edit the ad's wording" | लिखें कि सेवा क्या है, यह नहीं कि वह क्या ठीक करती है या किसकी गारंटी देती है। |
| `REVIEW_BUDGET` | "Set a daily budget above ₹0." या "Meta needs at least ₹96 a day. Set a daily budget of ₹96 or more." | "Set the daily budget" | रोज़ ₹300, ₹500 या ₹1,000 चुनें। |
| `REVIEW_NO_AGE_RANGE` | "Choose an age range, or let AdBrain recommend one, before reviewing." | "Set the age range" | उम्र चुनें, या **Recommend audience** दबाएँ। |
| `REVIEW_RADIUS` | "Set the city radius between 17 and 80 km; Meta allows nothing outside that range." | "Set the city radius" | 17 से 80 km के बीच radius चुनें। |
| `REVIEW_CITY_RADIUS` | City only "came back from Meta with a radius. Choose the locations again." | "Choose the locations again" | Locations दोबारा चुनें। |
| `REVIEW_AREAS_UNRESOLVED` | "Meta didn't recognise some of your areas. Fix or remove them, or choose nationwide targeting." (या इलाकों के नाम) | "Fix the areas" | Spelling ठीक करें, इलाका हटाएँ, या पूरा भारत चुनें। |
| `REVIEW_NO_AUDIENCE` | "Let AdBrain recommend the audience (Recommend audience) before reviewing." | "Go to Recommend audience" | **Recommend audience** दबाएँ और सुझाव रखें या बदलें। |
| `REVIEW_INTERESTS_UNRESOLVED` | "Meta didn't recognise some audience interests. Edit or remove them." (या उनके नाम) | "Edit the interests" | Interest हटाएँ, या Meta का सुझाया कोई चुनें। |
| `REVIEW_CHANGED` | रुकावट नहीं: Review के बाद campaign बदला, तो **Send to Meta** कहता है "This campaign changed after you checked it. Tap Check my campaign again, then Send to Meta." | कोई नहीं | **Check my campaign** फिर से दबाएँ, फिर **Send to Meta**। |
