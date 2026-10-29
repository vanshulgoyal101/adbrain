# कैंपेन की टारगेटिंग और बजट

यह [Campaign Targeting and Budget](../targeting-and-budget.md) का हिंदी रूप है; अंग्रेज़ी पेज बदले तो इसे भी बदलें।
[Features and workflows](../README.md) का हिस्सा।
[Prepare a Campaign](../launch.md#prepare-a-campaign) का एक स्टेप।

### टारगेटिंग और बजट

- नए ad sets Meta की Advantage+ audience इस्तेमाल करते हैं (#334)। इलाका और उसकी
  exclusions पक्की सीमाएँ हैं। Meta पक्की minimum age को ज़्यादा से ज़्यादा 25 तक रखने देता
  है और maximum 65 पर तय रखता है, इसलिए owner की age range एक `age_range` सुझाव के तौर
  पर भेजी जाती है; gender और interests भी सुझाव ही हैं। रिव्यू में लिखा आता है: "Meta may
  reach people beyond your age range and interests; never outside your area." जो कैंपेन
  पहले से लॉन्च हो चुके हैं, उनकी टारगेटिंग वैसी ही रहती है।
- **Edit ad words** (#775): रुके हुए या चल रहे AdBrain कैंपेन के More मेनू से किसी ऐड की
  headline, text या description बदली जा सकती है। Meta को ऐड का नया version जाता है (तस्वीर,
  9:16 और WhatsApp मैसेज वही रहते हैं), ऐड फिर से review में जाता है, और बाकी कुछ नहीं
  बदलता। Studio जैसी ही claim checks लगती हैं।
- बिज़नेस का सेव किया हुआ WhatsApp मैसेज (`businesses.whatsapp_template`, #840) ही हर नया
  WhatsApp कैंपेन भेजता है: पहले welcome, फिर एक पहले से लिखा मैसेज (चाहें तो Call now बटन
  के साथ) या ज़्यादा से ज़्यादा 3 सवाल। कैंपेन का अपना edit (ड्राफ़्ट `whatsappMessage`) इस पर
  भारी पड़ता है, और उस पर भी वही claim checks blocker की तरह लगती हैं। दोनों में से कोई न
  हो, तो AdBrain पहले की तरह हर कैंपेन के लिए greeting और prefill खुद लिखता है। Review बिल्कुल
  वही मैसेज (`whatsappMessage`) लौटाता है और launch वही भेजता है; edit किया हुआ या सेव किया
  हुआ मैसेज plan hash का हिस्सा है। Ledger में बटन दर्ज होता है, और यह भी कि मैसेज edit किया
  गया, सेव किया हुआ था या सुझाया गया। Composer में "WhatsApp message: Your saved message ·
  Edit for this campaign" वही fields और preview खोलता है ("Also save as my message" शुरू में
  बंद रहता है); Review का "When they tap" मैसेज को एक लाइन में और एक preview में दिखाता है,
  और अगर मैसेज की भाषा ऐड्स से अलग हो तो एक हल्का नोट दिखता है।
  #1081: यह बिज़नेस के सारे WhatsApp कैंपेन में पिछला open → message rate भी दिखाता है (10
  opens होने के बाद से), और जब पहले से लिखे मैसेज में न कोई offer हो न कोई नंबर ("Hi, I want
  info"), तो एक हल्का नोट; इनमें से कोई भी भेजना नहीं रोकता
  (`src/lib/campaign/whatsapp-handoff.ts`)।
  Quick questions में पहले से लिखा मैसेज नहीं होता, इसलिए AdBrain का अपना welcome ऐसा पढ़ता
  है: "…Tap a question below and we'll reply here." (चारों भाषाओं में; Brand कार्ड, composer और
  launch, तीनों जगह एक जैसा, #1121); owner का खुद लिखा welcome कभी नहीं बदला जाता।
  Brand पर, या Review के "Edit for this campaign" में "Quick questions" चुनने पर खाली बॉक्स
  Brand से 3 सुझावों से भर जाते हैं (`src/lib/campaign/whatsapp-questions.ts`, #905, #1114):
  ज़्यादा से ज़्यादा 2 offers, जैसे कोई ग्राहक पूछेगा, owner के अपने शब्दों में ("Can I book a
  free site survey?", "Can I get PM Surya Ghar subsidy help?"; Hinglish में "… book ho sakta
  hai?" / "… kaise milega?", Hindi और Punjabi में भी इसी तरह), फिर "What's the price?" या
  "Call me back"। जिस offer पर label लगा है, उसे label के बाद वाले शब्दों से पूछा जाता है; अगर
  सवाल 40 characters से लंबा हो जाए, तो offer की पहली चीज़ उसकी कीमत के साथ पूछी जाती है
  ("Can I get the $49 new-patient exam?"), नहीं तो offer खुद एक सवाल बनकर ("Check-up and
  cleaning for ₹499?"); जो फिर भी फ़िट न हो, उसे छोड़ दिया जाता है, claim को बीच में कभी नहीं
  काटा जाता। मुफ़्त offer को book करने के लिए पूछा जाता है, उसकी कीमत कभी नहीं पूछी जाती। ये
  सिर्फ़ सुझाव हैं: जब तक owner सेव न करे (या उन्हें कैंपेन के लिए इस्तेमाल न करे), कुछ नहीं
  भेजा जाता, और सेव करने पर claim check चलता है।
  #418 rule 7: जब हर ऐड की आख़िरी लाइन भेजने वाले शब्द quote करती है ('WhatsApp “Free site
  survey” to book'), तो AdBrain का सुझाया पहले से लिखा मैसेज ठीक वही शब्द होता है
  (`quotedAsk`)। जब कोई ऐड उन शब्दों से अलग शब्द quote करे जो WhatsApp पहले से लिखकर देगा
  (सेव किया हुआ या edit किया हुआ मैसेज), तो Review चेतावनी देता है (कभी रोकता नहीं): "An ad
  asks customers to send “…”, but WhatsApp pre-types “…”"।
  Quick questions चालू हो तो पहले से लिखा मैसेज नहीं होता, इसलिए जो ऐड कोई मैसेज quote करता
  है उसे इसकी जगह एक चेतावनी मिलती है (#1198): "Your ad promises a ready message, but
  customers will see quick questions…", साथ में **Change the last line**: एक टैप में हर quote
  करने वाले ऐड की आख़िरी लाइन, ऐड की अपनी भाषा में, "Tap, then pick a question to send." में
  बदल जाती है (approval वैसा ही रहता है) और कैंपेन फिर से check होता है।
  #418 rule 5: जब Brand के पास proof हो (कितने साल से बिज़नेस, कितने काम किए, कोई नामित
  credential या warranty; `src/lib/creative/proof-line.ts`) और चुने गए किसी भी ऐड में उसका
  ज़िक्र न हो, तो Review चेतावनी देता है (कभी रोकता नहीं) और एक proof का नाम बताता है ("None
  of these ads has a proof line from your Brand…")।
- हर भारतीय ad set service area के बाहर की हर चीज़ को भी exclude करता है (#741): हर वह
  राज्य/UT जिसमें कोई जगह शामिल नहीं (Tricity: Chandigarh, Punjab और Haryana के अलावा सब),
  और साथ में रखे गए राज्यों के वे बड़े शहर जो शामिल शहर के radius + 30 km से ज़्यादा दूर हैं
  (Ludhiana, Amritsar, Ambala, Gurugram…); जो राज्य पूरा शामिल है, उसके सारे शहर रहते हैं
  (#804)। जगहें Meta key से मिलाई जाती हैं (`src/lib/meta/service-area.ts`); owner की अपनी
  exclusions बनी रहती हैं। अगर Meta इलाके की जानकारी न दे सके, तो launch मना हो जाता है
  (`TARGETING_EXCLUSIONS_MISSING`), और इस नियम से पहले बना tree activate नहीं हो सकता।
  Advantage+ audience और interests के साथ Meta बाद में टारगेटिंग बदलने नहीं देता, इसलिए
  exclusions create के समय ही होनी चाहिए; live ad set पर टारगेटिंग बदलने से ऐड review फिर से
  शुरू होता है (#157 पर लगभग 5 मिनट)। पूरे देश वाले और भारत के बाहर के इलाकों पर अपने-आप
  कोई exclusion नहीं लगती।
- लिखे गए इलाकों के नाम बिज़नेस के देश (India; #1555) में ढूँढे जाते हैं: जिस नाम का Meta में
  अकेला match विदेश में हो, वह unresolved लौटता है ("Meta didn't recognise the area…"), जब
  तक owner ने उसका पूरा label न लिखा हो ("Austin, Texas")। Tricity के रोज़मर्रा के जिन नामों के
  लिए Meta में कोई जगह नहीं है, उनके लिए Meta की मौजूद जगहें ढूँढी जाती हैं
  (`src/lib/meta/geo-aliases.ts`, #1556): Tricity और Zirakpur → Chandigarh, Mohali,
  Panchkula; Derabassi → Dera Bassi; New Chandigarh, Aerocity → Mohali; शहर के साथ
  'Sector N'/'Phase N' → वह शहर (अकेला 'Sector 17' unresolved रहता है)। Meta में अकेला
  'Tricity' Tri-City, Oregon है।
- Creation से पहले हर कैंपेन में detailed interest targeting होना ज़रूरी है। AI plans को
  बिज़नेस और offer पर आधारित एक से पाँच relevant commercial interests देने होते हैं। जिस
  ड्राफ़्ट में interests गायब/खाली हों, उसे तैयार करने पर AI से सुझाव माँगे जाते हैं, तब भी जब
  location और age manual हों। पहले से मौजूद, ख़ाली न होने वाले सुझाव बदले और दोबारा इस्तेमाल
  किए जा सकते हैं; अधूरा ड्राफ़्ट सेव करने पर AI नहीं चलता।
- गायब या resolve न होने वाले interests creation को रोकते हैं, चुपचाप broad audience पर वापस
  नहीं जाते। Review और creation से पहले Meta interest IDs को validate करता है; हर ad set को वे
  detailed-targeting signals के तौर पर मिलते हैं। इससे custom audiences नहीं बनतीं, और यह
  गारंटी भी नहीं मिलती कि Meta delivery को इन signals से आगे कभी नहीं बढ़ाएगा।
  Restricted-category और sensitive-trait वाली सुरक्षाएँ अब भी लागू रहती हैं।
- Audience & location में gender को All genders (default), Men या Women रखा जा सकता है। यह
  ड्राफ़्ट के साथ सेव और वापस लोड होता है, review में दिखता है, और instant-form और WhatsApp
  दोनों तरह के कैंपेन के हर ad set पर लागू होता है। AI audience सुझाव owner का चुनाव बनाए
  रखते हैं; इसे बदलने पर नया review ज़रूरी है। जिन पुराने ड्राफ़्ट्स में यह field नहीं है, वे
  All genders पर रहते हैं। Editor की मौजूदा special-ad-category पाबंदियाँ अब भी लागू हैं।
- Location और age के "Let AdBrain decide" actions creative चुनने के तुरंत बाद एक audience
  सुझाव माँगते हैं, जिसे cancel किया जा सकता है। लौटे हुए इलाके, ages, radius, interests और
  rationale बदले जा सकते हैं; यह action न कुछ सेव करता है न कैंपेन बनाता है। फ़ेल होने पर
  पहले भरी चीज़ें बनी रहती हैं। सिर्फ़ audience वाली planning में बजट, creative का चुनाव,
  destination और lead form owner के हाथ में ही रहते हैं।
- Location एक ही बार पूछी जाती है, "Where should ads show?" में (#305)। "Let AdBrain decide"
  तय किए गए इलाके और exclusions एक summary में दिखाता है; "Choose myself" में location search
  के साथ लिखे हुए planned और excluded इलाके होते हैं।
- Planned और excluded इलाकों में हर लाइन पर एक जगह लिखी जाती है, ताकि नामों के अंदर के comma
  बने रहें। Manual इलाके और radius के बदलाव बने रहते हैं; साफ़ तौर पर नया location फ़ैसला
  माँगने पर पहले के सुझाए इलाके बदल दिए जाते हैं। सिर्फ़ age वाले फ़ैसले चुनी हुई geography
  नहीं छेड़ते। Geographic resolution exact नामों और पूरे city/region labels को पहले चुनता है,
  और जब कोई देश न दिया हो तो India मानकर नहीं चलता।
- Manual location search में loading, कोई match नहीं, और फ़ेल lookup अलग-अलग दिखते हैं। Retry
  करने पर चुनी हुई जगहें बनी रहती हैं; query बदलते ही पुराने चुनाव तुरंत हट जाते हैं। Results
  में region labels दिखते हैं, और arrow keys से चुनकर Enter दबाया जा सकता है। Escape, Tab, और
  picker से बाहर जाने पर results बंद हो जाते हैं, देर से आए जवाब भी।
- टारगेटिंग की मदद hover, focus, click या touch पर खुलती है; assistive technology के लिए
  explanations उनके triggers से जुड़ी हैं। Escape और बाहर click करने से मदद बंद हो जाती है, और
  उसकी जगह ऐसी रखी जाती है कि वह viewport के दाएँ-बाएँ किनारों के अंदर रहे।
- Ages की साफ़ सीमाएँ 18 और 65 के बीच होनी चाहिए, और minimum, maximum से ज़्यादा नहीं हो
  सकता; Meta का ऊपरी सिरा उसकी supported 65+ range को दर्शाता है।
- City coverage में City only (कोई radius नहीं जुड़ता) या City + radius मिलता है। नए manual
  ड्राफ़्ट्स शुरू में City only पर रहते हैं; guided planning भी इसी पर रहती है, जब तक आसपास के
  service areas radius को सही न ठहराएँ। जिन मौजूदा सेव ड्राफ़्ट्स में scope नहीं है, उनका radius
  वाला behavior वैसा ही रहता है। Scope शामिल और excluded दोनों शहरों पर लागू होता है, audience
  सुझावों के दौरान बना रहता है, और campaign review से बँधा होता है। States और countries नहीं
  बदलते। City-only payloads Meta city key बिना radius/distance units के भेजते हैं; resolve हुआ
  radius उलटा हो तो review रोक देता है। यह Meta का city area माँगता है, verified
  municipal-boundary polygon नहीं। Rollout से पहले असली account पर acceptance और लौटी coverage
  verify होनी चाहिए।
- City + radius के लिए preflight पर 17-80 km ज़रूरी है। Draft schemas 5-80 km मानते हैं ताकि
  सेव किया हुआ पुराना/अधूरा value बदला जा सके, इसलिए नहीं कि गलत radius launch हो सके।
- Background audience plan (#366): Choose settings में, ऐड्स चुनने के 1.5 s बाद (और अगर
  audience को अब भी AdBrain की ज़रूरत है), audience background में plan होती है, हर composer
  में ज़्यादा से ज़्यादा तीन बार। Prepare उस जवाब को एक बार इस्तेमाल करता है, अगर Campaign goal
  field, ऐड्स, टारगेटिंग और destination नहीं बदले और वह सफल रहा था (बाद में लिखा नाम या बजट
  नहीं गिना जाता); नहीं तो Prepare पुरानी request चुपचाप रोक देता है और पहले की तरह plan करता
  है। जवाब browser में ही रहता है।
- ज़्यादा से ज़्यादा पाँच interest नाम और एक ख़ाली न होने वाला rationale सेव किया जा सकता है।
  IDs और eligibility Meta resolve करता है; unresolved interests creation रोकते हैं।
- Geography गायब हो तो चुपचाप पूरे देश तक नहीं फैलती। पूरा देश (Nationwide) एक साफ़, review
  हो सकने वाला चुनाव होना चाहिए।
- Creation के लिए INR account और ज़ीरो से ज़्यादा daily budget ज़रूरी है। API में currency
  values पूरे रुपयों में होती हैं; Meta adapter उन्हें minor units में बदलता है।
- Optional age-split testing दो ad sets बनाती है। तब 200 रुपये का daily input मतलब कुल 400
  रुपये/दिन है, न कि 200 जो दोनों में बँटें। यह randomized Meta Experiments A/B test नहीं है।
- Lead estimates और interest सुझाव अंदाज़े (heuristics) हैं, delivery या conversion की गारंटी
  नहीं। Restricted-category support किसी AI declaration check से साबित नहीं होता।
