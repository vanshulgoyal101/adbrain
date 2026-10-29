# कैंपेन लॉन्च करें
<!-- mirrors ../launch.md 45a5bffd8a0d -->

यह [Launch a Campaign](../launch.md) का हिंदी रूप है; अंग्रेज़ी पेज बदले तो इसे भी बदलें।
[Features and workflows](../README.md) का हिस्सा।
टारगेटिंग और बजट: [Targeting and Budget](../targeting-and-budget.md#targeting-and-budget);
रिव्यू और लाइव करना: [Review, Create, Activate](../review.md#review-create-activate)।

## कैंपेन तैयार करें

मैनुअल और गाइडेड, दोनों तरीकों से एक सेव किया हुआ ड्राफ़्ट बनता है जिसे बदला जा सकता
है। ड्राफ़्ट अधूरा भी हो सकता है: सेव करते समय ज़ीरो बजट, कोई क्रिएटिव न चुना होना, और
कोई लीड फ़ॉर्म न होना, सब चलता है। Preflight के लिए ज़रूरी है: अप्रूव किए हुए क्रिएटिव,
ज़ीरो से ज़्यादा बजट, तय की हुई टारगेटिंग, और चुनी गई destination के लिए या तो एक active
फ़ॉर्म या Page से जुड़ा हुआ एक verified WhatsApp Business नंबर। सेव करने पर AI नहीं
चलता; AI-mode में audience के विकल्प तैयार करने पर चल सकता है।

ड्राफ़्ट बनने के सात दिन बाद expire हो जाते हैं, version 1 से शुरू होते हैं, और एक साथ
ज़्यादा से ज़्यादा 50 active, बदले जा सकने वाले ड्राफ़्ट रह सकते हैं। अपडेट के लिए
अपेक्षित version देना ज़रूरी है; किसी दूसरे टैब में किए गए बदलाव से conflict दिखता है,
चुपचाप overwrite नहीं होता। अपडेट करने से असली expiry आगे नहीं बढ़ती। जो ड्राफ़्ट किसी
creation operation से जुड़े हैं, उन्हें बदलने/मिटाने पर और पाबंदियाँ हैं।

नए कैंपेन का नाम उसके पहले चुने गए ऐड से बनता है, जब तक owner खुद नाम न लिखे:
headline · WhatsApp या Lead form · दिन, जैसे "Free 15-minute spine check · WhatsApp ·
Oct 28" (दिन तब दिखता है जब browser लोड हो चुका हो)। बिल्कुल वही ऐड दोबारा तैयार करने
पर नया ड्राफ़्ट नहीं जुड़ता, उनका सेव किया हुआ ड्राफ़्ट ही अपडेट होता है (#1151)। अगर वह ड्राफ़्ट
expire हो चुका है या किसी दूसरे टैब में हटाया गया है, तो owner के अभी के चुनाव नए ड्राफ़्ट में सेव होते
हैं; और जिस टैब का याद रखा ड्राफ़्ट अब नहीं है, वह load पर उसे भूल जाता है (जब तक कोई creation
चल न रहा हो), "Draft not found." नहीं दिखाता (#681)।
Review और Send to Meta की गलतियाँ owner की चुनी हुई भाषा में आती हैं (#2333)। अगर भेजते समय ड्राफ़्ट expire
हो चुका हो, तो Send to Meta यही बताता है, कि Meta को कुछ नहीं भेजा गया, और पेज रीलोड करने को कहता है,
जैसा Review करता है।

नया replacement review शुरू करते ही पुराना send action तुरंत बेकार हो जाता है। validation,
save या reconnect फ़ेल होने से किसी confirm हो चुके operation का status नहीं मिटता;
recovery तभी बदलती है जब नया ड्राफ़्ट सेव हो जाए।

गाइडेड इंटरव्यू हर बिज़नेस और destination के लिए अलग-अलग रखे जाते हैं। destination
बदलने, मैनुअल सेटअप चुनने या सेटअप बंद करने पर browser की request रुक जाती है और देर से
आए जवाब छोड़ दिए जाते हैं। फ़ेल या बीच में रुकी request अपने जवाब (payload) रखती है ताकि
आप जानबूझकर दोबारा कोशिश कर सकें, इंटरव्यू दोबारा खोलने के बाद भी। इससे server पर हो
चुका काम वापस नहीं होता, और यह गारंटी नहीं कि AI का बिल या ड्राफ़्ट सेव ठीक एक ही बार
होगा; दोबारा कोशिश से पहले Saved drafts देख लें। ड्राफ़्ट रिव्यू को सौंपे जाने के बाद पूरे
हो चुके इंटरव्यू पूरे ही रहते हैं।

Planner ब्रांड, अप्रूव किए हुए क्रिएटिव, active instructions और मौजूद performance
history का इस्तेमाल करता है। provider IDs खुद से गढ़ने के बजाय वह छूटी हुई जानकारी
पूछता है। audience की सिफ़ारिशें बदली जा सकती हैं; आपके मैनुअल चुनाव बने रहते हैं।
रिव्यू के बाद बनाने (reviewed creation) में **instant-form leads और WhatsApp chats**
चलते हैं, जब चुनी गई destination server preflight में पास हो। बिना destination वाले पुराने
ड्राफ़्ट instant-form कैंपेन ही रहते हैं। Call कैंपेन यह editor सपोर्ट नहीं करता।

### WhatsApp कैंपेन

- **Publish करने के लिए Page से जुड़ा एक verified नंबर ज़रूरी है।** जो रिव्यू eligible
  हैं, उनमें Send to Meta (paused) मिलता है; linkage न हो या पढ़ा न जा सके तो publish
  अब भी रुका रहता है। पहले 2026-09-19 के read-only check में, पहले पायलट के Page ने Page
  और system-user, दोनों tokens के साथ अपने linkage/number fields नहीं दिए। किसी मौजूदा
  ad set का पुराना recipient, आज के linkage का सबूत नहीं माना जाता। कोई test कैंपेन नहीं
  बनाया गया।
- मैनुअल या गाइडेड, किसी भी सेटअप में WhatsApp chat चुनें। WhatsApp की planning/review
  के लिए कोई लीड फ़ॉर्म ज़रूरी नहीं है और लोड भी नहीं होता; चुनी गई destination बनी
  रहती है।
- पहले Meta में अपने चुने हुए Facebook Page से एक WhatsApp Business नंबर जोड़ें। रिव्यू
  उस Page के token से Page का `has_whatsapp_business_number` और `whatsapp_number`
  पढ़ता है। सबूत न हो, पढ़ा न जा सके या गलत हो, तो कैंपेन नहीं बनता। Page पर लिखा आम
  contact फ़ोन नंबर काफ़ी नहीं है।
- कैंपेन ड्राफ़्ट अपना अलग WhatsApp button नंबर (`whatsappNumber`) रख सकता है, ताकि
  button का नंबर ऐड पर छपे फ़ोन से अलग हो सके। यह तभी माना जाता है जब यह Page का नंबर
  हो या ऐसे WhatsApp Business Account का नंबर हो जो ad account के अपने Meta business का
  है; Page के WhatsApp ad sets के लिए Meta इन्हें मानता है (#157)।
- Brand और Settings पहले ही दिखा देते हैं कि WhatsApp chat ऐड चल सकते हैं या नहीं
  ("Ready: +91 ••••• 4842 (linked to your Page)" या "Not linked yet"), साथ में जोड़ने की
  छोटी गाइड और एक Check again बटन (#235)।
- मैनुअल सेटअप में कैंपेन फ़ॉर्म इन नंबरों को **WhatsApp button number** के नाम से
  दिखाता है (masked; रिव्यू से पहले पूरे नंबर browser तक कभी नहीं पहुँचते) और चुना गया
  mask ड्राफ़्ट में सेव करता है; preflight उसे पूरे नंबर में बदलता है। नया कैंपेन, और
  AdBrain का बनाया plan, **WhatsApp chat (recommended)** पर खुलता है, जो सबसे ऊपर है;
  अगर कोई नंबर तैयार नहीं है तो सेटअप बताता है कि नंबर कैसे जोड़ें, साथ में एक-टैप वाला
  "Use an Instant form for now" होता है, और Create का "Review this ad" रुका हुआ रिव्यू
  तैयार करने के बजाय इंतज़ार करता है (#1171)। Instant form दूसरा विकल्प है और अब भी पूरी
  तरह सपोर्टेड है; वापस खोला गया ड्राफ़्ट अपनी destination रखता है।
  Brand का Website "optional: lets AdBrain fill this page for you" लिखा दिखता है (#1238)
  और readiness गिनती में नहीं आता। गाइडेड ड्राफ़्ट Page का अपना नंबर इस्तेमाल करता है,
  जब तक उसे मैनुअल सेटअप से दोबारा तैयार न किया जाए।
- रिव्यू verified नंबर दिखाता है और उसका hash बनाता है। कुछ भी बदलने (mutation) से पहले
  creation उसे फिर से जाँचता है। WhatsApp कभी चुपचाप फ़ॉर्म पर नहीं चला जाता।
- WhatsApp creation adapter `OUTCOME_ENGAGEMENT`, `CONVERSATIONS`, `WHATSAPP`, एक
  recipient से बंधा promoted object और `wa.me` creative link इस्तेमाल करता है। कैंपेन,
  ad sets और ads PAUSED बनते हैं; चालू करना (activation) अलग confirmation ही रहता है।
- WhatsApp कैंपेन के नतीजे बताते हैं कि कितने लोगों ने WhatsApp खोला और कितनों ने मैसेज
  किया ("12 opened WhatsApp, 1 messaged you": Meta `link_click` बनाम
  `messaging_conversation_started_7d`, #493)।
- **4 tips to get more replies** (#493, #1154): Campaigns पर, WhatsApp कैंपेन सेट करते
  या चलाते समय, owner के WhatsApp Business app के लिए एक मुड़ी हुई (folded) checklist:
  profile photo और नाम, greeting message, away message, 5 मिनट के अंदर जवाब। ये
  optional टिप्स हैं, इसलिए लाइन में गिनती तभी दिखती है जब कोई एक टिक हो ("2 of 4
  done")। AdBrain इन्हें पढ़ नहीं सकता, इसलिए owner खुद टिक करता है; टिक उसी डिवाइस पर
  हर बिज़नेस के लिए रखे जाते हैं। WhatsApp के AI reply की तरफ़ कोई इशारा नहीं है (#1171;
  tag `removed/whatsapp-ai-card`)।
- जब कोई सेटअप खुला न हो, Campaigns पहले कैंपेन की लिस्ट दिखाता है; Saved drafts लिस्ट
  के बाद आते हैं (#1154), और सेटअप खुला हो तो सेटअप के ऊपर एक लाइन में सिमट जाते हैं।
- हर WhatsApp क्रिएटिव में Brand की जानकारी से बना एक `page_welcome_message` होता है
  (#209, #493): ग्राहक से मैसेज भेजने को कहने वाला एक छोटा greeting, और एक छोटा पहले से
  लिखा सवाल ("Hi! I'd like a free site survey.") जिसमें ऐड में बताया गया एक offer (पहले
  कोई free offer) होता है, और शहर, अगर कैंपेन ठीक एक शहर को टारगेट करता है। इसकी भाषा
  सेटअप में हर कैंपेन के लिए चुनी जाती है (**Message language**): Same as the ad
  (default: ऐड की सेव की हुई भाषा, जहाँ सिर्फ़ "Hindi"/"Punjabi" लिपि के हिसाब से चलती है
  और Roman अक्षरों में हो तो Hinglish पढ़ी जाती है; नहीं तो Devanagari → Hindi, Gurmukhi →
  Punjabi, Roman लिपि वाली Hindi → Hinglish (#1081), वरना English), English, Hindi,
  Hinglish या Punjabi। welcome भी उसी भाषा में होता है। यह चुनाव रिव्यू किए गए plan का
  हिस्सा है।
- Stories और Reels को हर WhatsApp और lead-form ऐड का 9:16 version मिलता है (#333, #680):
  Prepare सेव किए हुए design और फ़ोटो को 1080×1920 पर सजाता है (कोई AI call नहीं; शब्द,
  logo और offer Stories/Reels के safe zone के अंदर रहते हैं, ऊपर 14%, नीचे 35%, किनारों
  पर 6%, और शब्द ऊपर हों तो फ़ोटो ऊपर की safe line से शुरू होती है ताकि उसका मुख्य हिस्सा
  स्क्रीन पर रहे, #1077) और दोनों images `asset_feed_spec` placement rules से भेजता है:
  Facebook/Instagram/Messenger की stories और reels को 9:16 मिलता है, बाकी हर position
  (नाम लेकर बताई गई; Meta को हर placement के लिए ठीक एक rule चाहिए) को 4:5। क्रिएटिव में
  Page का Instagram account (`instagram_user_id`) लिखा होता है, जिसके बिना Meta ऐड मना
  कर देता है। Page का Instagram न हो, render 6 s से ज़्यादा ले, upload फ़ेल हो, या Meta
  क्रिएटिव या ऐड मना कर दे, तो अकेली 4:5 image पर लौट आते हैं और
  `campaign.story_fallback` log होता है। lead-form ऐड अपने फ़ॉर्म का नाम
  `asset_feed_spec.call_to_actions` में देता है (इसके बिना Meta मना करता है, 3390001)।
  Meta के असली जवाब `scripts/record-meta-story-fixtures.ts` और
  `scripts/record-meta-leadform-placements.ts` रिकॉर्ड करते हैं।
- **Which ad worked** (#783, `AD_RESULTS_ENABLED` के पीछे): लॉन्च हुए कैंपेन के card में
  एक बंद (collapsed) हिस्सा होता है जो पहली बार खोलने पर हर ऐड के सेव किए नतीजे लोड करता
  है: enquiries और ₹ प्रति enquiry (पहली enquiry से पहले "—"), "Best" सिर्फ़ तब जब ≥ 5
  enquiries हों और अगले ऐड से ≥ 30% सस्ता हो, वरना "Early: too few enquiries to pick a
  winner"। AdBrain के अपने ऐड 40 px की तस्वीर और अपनी headline दिखाते हैं; बाहर के ऐड Meta
  वाला नाम रखते हैं। capped run अपनी चल रही copies दिखाता है; पुरानी copy तभी दिखती है जब
  वह deliver हुई हो, "(earlier run)" लिखकर। जिन ऐड को Meta ने नहीं दिखाया, वे यह बताते
  हैं; audience edit से बदले गए ऐड पर निशान होता है; 3 से ज़्यादा "All ads" के पीछे रहते
  हैं। Refresh नंबर सेव करता है (`ad_results`)।
  #1045: पूरे कैंपेन में कम से कम 5 enquiries होने पर, जो चलता हुआ ऐड प्रति enquiry
  सबसे अच्छे ऐड से ≥ 2× महँगा है (या बिना किसी enquiry के कैंपेन की cost per enquiry
  का ≥ 2× खर्च कर चुका है), उसे एक लाइन मिलती है: "“B” costs ₹X per enquiry vs ₹Y for
  “A”. Pause it?" [Pause this ad] [Keep]। Pause सिर्फ़ उसी ऐड को बंद करता है (Meta से
  वापस पढ़कर पक्का किया जाता है) और card पर undo किया जा सकता है; Keep उसे 3 दिन के लिए
  छिपा देता है। यह कभी अपने-आप नहीं होता, और कभी बजट नहीं बदलता। कैंपेन वापस चालू करने
  पर वह ऐड paused ही रहता है (#1055): capped resume सिर्फ़ बाकी ऐड copy करता है, और
  रिव्यू यह बताता है।
- **Daily results on WhatsApp** (#1022, `OWNER_ALERTS_ENABLED` के पीछे बंद): सुबह 09:00
  IST से, opt-in करने वाले हर owner को कल (IST) के लिए एक `adbrain_daily_results` लाइन
  मिलती है: कितने ₹ खर्च हुए, कितने लोगों ने मैसेज किया या फ़ॉर्म भरा ("Which ad worked"
  वाले ही प्रति-ऐड नंबर), हर एक पर ₹ या "none yet", और जिस ऐड का नाम लेना है वह, उसके
  लोगों की गिनती के साथ (#783 का best, नहीं तो सबसे ज़्यादा लोग, नहीं तो सबसे ज़्यादा
  WhatsApp taps; #1720 ने "enquiries" हटाया)। जिस दिन न कोई खर्च हुआ और न कोई enquiry
  आई, उस दिन कोई लाइन नहीं आती; monthly cap पर सिर्फ़ यह लाइन रुकती है।
- WhatsApp और नए lead-form ad sets सिर्फ़ Facebook, Instagram और Messenger पर चलते हैं
  (#906, #680), ताकि WhatsApp बनाम lead-form A/B में फ़र्क सिर्फ़ destination का हो:
  `publisher_platforms` Audience Network को बाहर रखता है (#157 पर इसके ज़्यादातर WhatsApp
  taps गलती से हुए थे); इनके अंदर positions automatic रहती हैं। रिव्यू में "Shown on
  Facebook, Instagram and Messenger" लिखा आता है, plan check इसे पास करता है, और #588
  ledger `placements: "advantage:facebook,instagram,messenger"` रिकॉर्ड करता है।
  WhatsApp ad set पर audience edit भी यही नियम लगाता है; किसी पुराने lead-form ad set पर
  edit उसकी placements वैसी ही रखता है।
- हर लॉन्च, भेजे गए payloads को Meta की new-advertiser guidance से मिलाता है (Advantage+
  audience और placements, एक ad set, बजट बनाम learning, 4:5 और 9:16 images) और
  `campaign.plan_check` log करता है (#419)। लागू होने पर रिव्यू दो सीधी, न रोकने वाली
  चेतावनियाँ दिखाता है (#419 2b): "No 9:16 ad" जब किसी ऐड को 9:16 नहीं मिलेगा (बिना सेव
  किए design वाला ऐड), और "Budget is below what Meta needs to learn" जब हर ad set का बजट,
  बिज़नेस के अपने पिछले 60 दिन के सेव किए नतीजों की cost per result पर, हफ़्ते में ~50 से
  कम नतीजे खरीदता है (history नहीं, तो बजट वाली चेतावनी नहीं)। इनमें से कोई भी रिव्यू किए
  गए plan या send को नहीं बदलती।
  Activation review उन बदलावों को लिखता है जो AdBrain करता है और जिनसे Meta की learning
  फिर से शुरू होती है (#419 item 2), ये भी कभी नहीं रोकते और confirmation digest से बाहर
  हैं: capped run ऐड को एक नए ad set में copy करता है जो ज़ीरो से सीखता है (बिज़नेस की
  cost per result के साथ, सिर्फ़ तब जब उसके दिनों का बजट ~50 से कम नतीजे खरीदे), और ऐसे
  कैंपेन को resume करना जिसे owner ने या AdBrain के spend auto-pause ने 7 या ज़्यादा दिन
  पहले pause किया था (audit log से; Meta में किया गया pause नहीं दिखता)।
- सिर्फ़ वही कैंपेन अपने card से resume हो सकते हैं जो AdBrain ने लॉन्च किए थे। जो paused
  कैंपेन Meta से sync हुआ था (या AdBrain के उसके ad sets और ads रखने से पहले सेव हुआ था),
  वह कारण के साथ "Resume in Ads Manager" दिखाता है (#662)। card action (review, pause,
  refresh, delete) की error उसी card पर दिखती है, और खुला हुआ activation review scroll
  होकर सामने आ जाता है।
- मौजूदा WhatsApp कैंपेन भी उसी account/Page से बंधे import, refresh, pause और
  activation safeguards इस्तेमाल करते हैं। सेव किए नतीजे lifetime insights हैं
  (`date_preset=maximum`): Meta का default `last_30d` आज का दिन छोड़ देता है, इसलिए नया
  कैंपेन पहले ₹0 पढ़ता था (#404)। Refresh पूरी तरह WhatsApp वाले ad sets पहचानता है और
  `onsite_conversion.messaging_conversation_started_7d` को leads से अलग सेव करता है।
  एक-दूसरे पर चढ़े (overlapping) messaging actions जोड़े नहीं जाते। जिन कैंपेन में
  अलग-अलग destinations हैं, उन्हें पूरा का पूरा WhatsApp के नाम नहीं किया जाता।
- कैंपेन cards conversations और cost per conversation दिखाते हैं; planner history और
  summaries conversations को verified leads/sales से अलग रखते हैं। इससे chat messages,
  phone contacts, transcripts या WhatsApp inbox की leads import नहीं होतीं। Leads-tab
  sync सिर्फ़ instant-form के लिए ही है।
- हर chat ग्राहक नहीं होती (#335)। WhatsApp कैंपेन के नतीजों में **Add enquiry** होता है
  (नाम, फ़ोन और note optional): हर एक Enquiries में कैंपेन के साथ "WhatsApp chat (added
  by you)" के रूप में सेव होती है, और card cost per conversation के साथ असली enquiries और
  cost per real enquiry (खर्च ÷ असली enquiries) दिखाता है।
- नया reporting code deploy करने से पहले, अलग migration authorization के साथ,
  `db/migrations/20260918_whatsapp_results.sql` लागू करें। मौजूदा नतीजे वैसे ही रहते हैं
  (नए columns null हैं); conversations भरने के लिए नतीजे refresh करें।
- Meta Page field references जाँचे गए थे; mocked provider tests असली account की
  eligibility, delivery या Graph v21 payload के माने जाने को पक्का नहीं करते। rollout से
  पहले, साफ़ अनुमति लेकर, असली account पर PAUSED creation test करें। इस implementation से
  कोई भी live पायलट कैंपेन नहीं बदला गया है।
