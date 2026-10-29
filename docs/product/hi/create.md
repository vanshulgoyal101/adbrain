# ऐड बनाएँ और जाँचें

यह [Create and Review Ads](../create.md) का हिंदी रूप है; अंग्रेज़ी पेज बदले तो इसे भी बदलें।
[Features and workflows](../README.md) का हिस्सा।

## Creatives बनाएँ और जाँचें

जब तक किसी business का कोई campaign live नहीं हुआ (या अभी चालू नहीं है), तब तक `/create`
setup के 3 में से दूसरा step है (#1251 WS1, #1270; हिंदी में भी, #1438, sales sample pack को
छोड़कर)। अगर कोई saved batch नहीं है, तो यह मौजूदा interview चलाता है (किसी भी सवाल का
जवाब "Let the AI decide", ज़्यादा से ज़्यादा 3 सवाल) और एक 3-ad Create run, Brand की पहली
भाषा में; वह न हो तो segment की default भाषा में (solar → Hinglish, बाकी English; #1681)।
Step 1 (और step 2, जब तक "Make 3 ads" पर tap न हुआ हो) पर दिखता है "Your ads will be in:
English · Hinglish · हिंदी · ਪੰਜਾਬੀ"; चुनी हुई भाषा पहले Brand `languages` में save होती है,
और progress एक बार में एक line में दिखती है। फिर यह सबसे नया batch (`variant_group`) दिखाता
है, जिसमें 2 ऐड एक तय नियम से पहले से चुने होते हैं (`setupPicks`: सबसे कम text repairs,
फिर कोई image fallback नहीं, फिर बनने का क्रम)। "Continue" चुने हुए ऐड approve करता है और
`/campaigns?new=1&creatives=…` खोलता है। Generation id localStorage में 15 minutes तक रखा
जाता है (#1402), इसलिए वापस आने पर या दूसरे tab में नया run शुरू करने की जगह saved ऐड पढ़े
जाते हैं; step "processing" और "partial" के दौरान इंतज़ार करता है, "unresolved" को कम ऐड के
साथ पूरा मानता है, और पहुँचते ही सबसे नया batch जाँचता है (#1407)। जिस tab को batch के ऐड
मिलते हैं, वह उन्हें localStorage में डाल देता है (`setup-generation-result:{businessId}`,
15 minutes), ताकि इंतज़ार कर रहे दूसरे tabs उन्हें तुरंत दिखा दें; shared status budget से
429 आए तो Retry-After तक इंतज़ार होता है (#1534)। Batch के बीच में खोलने पर step कहता है
"Making your ads…" और Continue तब तक रुकता है ("N more on the way…") जब तक बाकी ऐड न आ
जाएँ या batch कम ऐड के साथ खत्म न हो (#1564)। जो ऐड नहीं बने, उनके लिए दिखता है "N ads
couldn't be made. Make another", और top-up अपने batch के बगल में दिखता है (`setupBatch`)।
सिर्फ़ आज के step 1 से बने ऐड गिने जाते हैं (`madeForSetup`: receipt का source fact आज का
`setupGoal` है, #1432): owner के यह बदलने पर कि वे क्या बेचते हैं, कहाँ बेचते हैं या उनका
offer क्या है, step 2 नए ऐड बनाता है, और step 3 पुराने approved ऐड दिखाने की जगह वापस step 2
पर भेजता है। ऐसे पुराने ऐड हों (पुरानी details वाले, या Studio में approve किए हुए) तो step 2
खुद से कभी paid batch शुरू नहीं करता: यह "Make 3 ads" (एक tap) और "Use your earlier ads" →
`/campaigns?all=1` दिखाता है; दूसरे tab में पहले से चल रहा batch फिर भी आगे चलता है (#1475)।
`/create?all=1` नीचे वाला पूरा Create खोलता है।

1. जब business के campaigns के results हों, तो Create एक line से खुलता है, जैसे "Your
   “Roof ready?” ad got 1 chat at ₹10.69 (early: based on 1 chat). Make 3 more like it, or
   try a new angle?" **More like this** goal भर देता है और उस ऐड का brief इस्तेमाल करता है,
   उसके offer, price या percentage वाले वाक्यों के बिना, साथ में उसका angle reference के
   तौर पर, ताकि offer सिर्फ़ आज के Brand से आए; **New angle** एक नया goal भरता है (#371)।
   Create में goal लिखें, English, Hindi, Hinglish या Punjabi में, और **Ad
   language** चुनें (English · Hinglish · हिंदी · ਪੰਜਾਬੀ)। यह Brand की पहली भाषा पर शुरू होता
   है; आप न चुनें तो assistant की सुझाई भाषा इस्तेमाल होती है। यह review step पर फिर दिखता
   है। Brand के हिसाब से और मौसम के हिसाब से starters सिर्फ़ सुझाव हैं, अपने आप campaign
   schedule करने वाला system नहीं।
2. Interviewer ज़्यादा से ज़्यादा तीन नए फ़ैसले पूछ सकता है, या saved facts काफ़ी हों तो तुरंत
   खत्म कर सकता है। यह उसी भाषा में पूछता है जिसमें आप लिखते हैं (#290)। सवालों में context
   के हिसाब से choices या text input होता है।
   कोई step fail हो तो **Change my answer** आखिरी सवाल वापस लाता है, लिखा हुआ जवाब पहले से
   भरा होता है; **Start over** chat में हमेशा मौजूद रहता है।
3. पूरा brief देखें और बदलें। इसे बदलने से generation input बदलता है।
4. साफ़ तौर पर generate करें। Studio 1-6 variants लेता है; Create का standard batch तीन का है।
   API का default portrait है; square, story और landscape भी हैं।
5. हर image और copy देखें, फिर चुने हुए creatives approve करें। Factual claims, भाषा की
   quality और visual सही होने के लिए इंसान का review ज़रूरी है।

Variants अलग-अलग save होते हैं। Partial batch saved creatives और failures लौटाता है, यह
दिखावा नहीं करता कि हर variant सफल रहा। Browser disconnect हो जाए तो दूसरी paid request शुरू
करने से पहले उसी generation ID से saved results जाँचने चाहिए। Browser recovery metadata
session storage में user/business तक सीमित है; यह अलग-अलग devices पर टिकने वाली generation
idempotency नहीं है।

Review board ऐड को Create batch (`variant_group`) के हिसाब से group करता है: सबसे नया batch
सबसे ऊपर और खुला, पुराने batches बंद (folded) (#762)। 7 दिन से पुराने बिना review वाले ऐड, और
batch में से किसी एक के approve होने के बाद न चुने गए ऐड (#1148), एक बंद "Set aside" section
में रहते हैं और Needs review count से हट जाते हैं (Home के count से भी); यह सिर्फ़ दिखाने का
फ़र्क है, इसलिए किसी को approve करने पर वह वापस आ जाता है। Approved ऐड हों और कोई campaign
चालू, paused या draft में न हो, तो Home का अगला step है "Launch a campaign with your
approved ads", किसी भी review से पहले।

नए saved creatives Review board और generated Assets tiles के लिए छोटा WebP इस्तेमाल करते
हैं, जब derivative छोटा हो और उसका upload सफल हो। Inspect, Open, Download, ZIP export और
campaign delivery में original image ही रहती है। Derivative fail हो तो original उपलब्ध रहती
है; पुराने creatives और upload किए गए brand assets पीछे जाकर resize नहीं होते।

Approved ऐड share करने पर browser में stored WebP एक full-size JPEG (`.jpg`) में बदल जाता
है, desktop download fallback में भी (#2016)। Transparent हिस्से सफ़ेद हो जाते हैं। पहले से
मौजूद PNG/JPEG तस्वीरें वैसी ही रहती हैं। Conversion fail हो तो WebP share या download करने
की जगह मौजूदा preparation error दिखता है।

Regeneration creative की saved भाषा/format इस्तेमाल करता है, उसी creative को update करता है,
और approval को `draft` पर reset करता है। Approval `draft`/`approved` के बीच बदलता है; यह
मौजूदा remote ads नहीं बदलता। Local creative delete करना उससे पहले से बने Meta ad को delete
करने की request नहीं है।

Studio का Background editor optional "Or describe an AI picture" field से पहले saved Brand
photos दिखाता है। इसे खोलने पर वह text field focus नहीं होता; owner phone का keyboard खोले
बिना photo चुन सकता है।

नए creative concepts में headline, primary text और एक अलग Meta link description ज़रूरी है।
Copy पूरी brand profile दोहराने की जगह brief से जुड़े एक तर्क, उसके समर्थन वाले facts और एक
साफ़ अगले step पर टिकी होती है। Generation और regeneration उसी business के 12 तक हाल के
creatives load करते हैं; batch के पहले वाले concepts भी शामिल होते हैं। Normalized headline
या पहले आठ शब्दों वाला hook हूबहू दोहराया जाए तो image generation से पहले मौजूदा एक repair
attempt चलता है। हाल के ऐड सिर्फ़ variety के लिए guide करते हैं, commercial claims का सबूत
नहीं हैं। History lookup fail हो तो paid calls से पहले generation रुक जाता है। इससे एक साथ
चल रही requests में मतलब के स्तर पर अलग होने की, या campaign के बेहतर चलने की guarantee नहीं
मिलती।

Descriptions मौजूदा generation receipt में store होती हैं, Create और Studio में दिखती हैं,
copy exports और campaign review hashes में शामिल होती हैं, और Meta को link description के तौर
पर भेजी जाती हैं। Legacy creatives अपने आप दोबारा नहीं लिखे जाते। कौन-से placements
description दिखाएँगे, यह Meta तय करता है; field भरने से यह guarantee नहीं कि वह हर preview में
दिखेगी। इस generation behavior के बदलने से कोई live ads नहीं बदलते।

ZIP export में चुनी हुई copy और उपलब्ध images होती हैं। जिन selections तक पहुँच न हो, वे
fail होते हैं; unavailable/over-limit images एक note और `X-Images-Skipped` के साथ छोड़ी जा
सकती हैं। सफल ZIP response में हर image होना ज़रूरी नहीं। Route को approved status की ज़रूरत
नहीं, भले ही review-first ही सुझाया गया workflow है।
