# Appendix D · Cuisine & Category Taxonomy (100+ — seeded to `cuisine_taxonomy`)

Vendors pick up to 5 primaries via search-and-select (file 21). Synonyms power Bangla/Banglish search (file 02 §2.1.3).
Founder/Admin can extend in Admin -> Catalog; keys are immutable slugs.
**Entries: 117** (requirement was 100+ searchable categories — satisfied with room to grow).


| Key | EN | BN | Parent | Search synonyms |
|---|---|---|---|---|
| `bangladeshi` | Bangladeshi | বাংলাদেশি | — | deshi,bangla,bengali |
| `biryani` | Biryani | বিরিয়ানি | bangladeshi | briyani,biriyani,kacchi |
| `khichuri` | Khichuri | খিচুড়ি | bangladeshi | khichdi |
| `tehari` | Tehari | তেহারি | bangladeshi | tehri |
| `morog_polao` | Morog Polao | মোরগ পোলাও | bangladeshi | — |
| `rice_dishes` | Rice Dishes | ভাত জাতীয় | bangladeshi | bhaat,vat |
| `curry` | Curry | তরকারি/কারি | bangladeshi | torkari,jhol |
| `bhuna` | Bhuna | ভুনা | bangladeshi | kala bhuna |
| `fish` | Fish | মাছ | bangladeshi | mach,ilish,rui |
| `ilish` | Ilish Specials | ইলিশ | fish | hilsha |
| `bhorta` | Bhorta | ভর্তা | bangladeshi | vorta |
| `bhaji` | Bhaji | ভাজি | bangladeshi | vaji |
| `dal` | Dal & Lentils | ডাল | bangladeshi | daal |
| `beef` | Beef | গরুর মাংস | bangladeshi | gorur mangsho |
| `chicken_deshi` | Deshi Chicken | দেশি মুরগি | bangladeshi | — |
| `mutton` | Mutton | খাসির মাংস | bangladeshi | khashi,goat |
| `duck` | Duck | হাঁস | bangladeshi | hash |
| `pitha` | Pitha | পিঠা | bangladeshi | — |
| `fuchka` | Fuchka & Chotpoti | ফুচকা-চটপটি | street | phuchka |
| `street` | Street Food | স্ট্রিট ফুড | — | rastar khabar |
| `chaap` | Chaap | চাপ | street | chap |
| `kebab` | Kebab | কাবাব | grill | kabab,sheekh |
| `grill` | Grill & BBQ | গ্রিল | — | bbq,tandoori grill |
| `tandoori` | Tandoori | তান্দুরি | grill | — |
| `naan_roti` | Naan & Roti | নান-রুটি | breads | rumali,paratha,porota |
| `breads` | Breads | রুটি জাতীয় | — | — |
| `snacks` | Snacks | নাস্তা | — | nasta,evening snacks |
| `singara` | Singara & Somosa | সিঙ্গারা-সমুচা | snacks | samosa |
| `fast_food` | Fast Food | ফাস্ট ফুড | — | — |
| `burgers` | Burgers | বার্গার | fast_food | burger |
| `pizza` | Pizza | পিজ্জা | italian | piza |
| `pasta` | Pasta | পাস্তা | italian | spaghetti,penne |
| `italian` | Italian | ইতালিয়ান | — | — |
| `fried_chicken` | Fried Chicken | ফ্রাইড চিকেন | fast_food | crispy chicken,broast |
| `wings` | Chicken Wings | উইংস | fried_chicken | — |
| `fries` | Fries & Sides | ফ্রাইজ | fast_food | french fries,wedges |
| `sandwich` | Sandwiches | স্যান্ডউইচ | fast_food | sub,club |
| `shawarma` | Shawarma & Wraps | শাওয়ারমা | middle_eastern | wrap,roll |
| `middle_eastern` | Middle Eastern | মধ্যপ্রাচ্য | — | arabic |
| `chinese` | Chinese | চাইনিজ | — | chowmein deshi |
| `chowmein` | Chowmein & Noodles | চাউমিন | chinese | noodles,hakka |
| `fried_rice` | Fried Rice | ফ্রাইড রাইস | chinese | — |
| `soup` | Soups | স্যুপ | — | sup,hot and sour |
| `thai` | Thai | থাই | — | pad thai,tom yum |
| `indian` | Indian | ভারতীয় | — | dosa,idli,punjabi |
| `south_indian` | South Indian | দক্ষিণ ভারতীয় | indian | dosa |
| `mughlai` | Mughlai | মোগলাই | bangladeshi | moghlai |
| `set_meal` | Set Meals | সেট মিল | — | combo,platter,thali |
| `seafood` | Seafood | সি-ফুড | fish | chingri,prawn,crab |
| `prawn` | Prawn & Chingri | চিংড়ি | seafood | — |
| `cakes` | Cakes | কেক | bakery | pastry,birthday |
| `bakery` | Bakery | বেকারি | — | — |
| `dessert` | Desserts | মিষ্টি জাতীয় | — | sweet,dessert |
| `sweets` | Bangla Sweets | মিষ্টি | dessert | mishti,rasgulla,sandesh,doi |
| `ice_cream` | Ice Cream | আইসক্রিম | dessert | kulfi |
| `faluda` | Faluda | ফালুদা | dessert | — |
| `juice` | Juice & Lassi | জুস-লাচ্ছি | drinks | borhani |
| `drinks` | Drinks | পানীয় | — | beverage |
| `cafe` | Cafe | ক্যাফে | drinks | — |
| `coffee` | Coffee | কফি | cafe | espresso,cappuccino |
| `tea` | Tea & Cha | চা | cafe | cha,dudh cha |
| `breakfast` | Breakfast | সকালের নাস্তা | — | nashta |
| `healthy` | Healthy | স্বাস্থ্যকর | — | diet,light |
| `salad` | Salads | সালাদ | healthy | — |
| `vegetarian` | Vegetarian | নিরামিষ | — | veg,niramish |
| `vegan` | Vegan | ভেগান | vegetarian | — |
| `keto` | Keto & Diet | কিটো | healthy | low carb |
| `japanese` | Japanese | জাপানিজ | — | sushi,ramen |
| `korean` | Korean | কোরিয়ান | — | kimbap,bibimbap |
| `mexican` | Mexican | মেক্সিকান | — | taco,burrito,nachos |
| `continental` | Continental | কন্টিনেন্টাল | — | steak |
| `steak` | Steaks | স্টেক | continental | — |
| `homemade` | Homemade Deshi | ঘরোয়া খাবার | home_kitchen | ghorer khabar |
| `home_kitchen` | Home Kitchen Specials | হোম কিচেন | — | homemade |
| `achaar` | Achaar & Sides | আচার | bangladeshi | pickle |
| `peyaju` | Peyaju & Fritters | পেঁয়াজু | snacks | bora,pakora |
| `haleem` | Haleem | হালিম | bangladeshi | — |
| `nihari` | Nihari & Paya | নেহারি | bangladeshi | — |
| `khabsa` | Khabsa & Mandi | খাবসা | middle_eastern | mandi |
| `rolls` | Rolls | রোল | snacks | kathi roll |
| `momos` | Momos | মোমো | snacks | dumpling |
| `ramen` | Ramen | রামেন | japanese | — |
| `sushi` | Sushi | সুশি | japanese | — |
| `wings_bbq` | BBQ Platters | বিবিকিউ প্ল্যাটার | grill | — |
| `kacchi` | Kacchi Biryani | কাচ্চি | biryani | dhakaiya kacchi |
| `chicken_roast` | Chicken Roast Sets | মোরগ রোস্ট | set_meal | — |
| `beef_kala` | Kala Bhuna | কালা ভুনা | bhuna | — |
| `shutki` | Shutki | শুঁটকি | bangladeshi | dried fish |
| `chingri_malai` | Chingri Malaikari | চিংড়ি মালাইকারি | prawn | — |
| `rui_curry` | Rui & River Fish | রুই | fish | katla,pabda,tengra,koi |
| `egg` | Egg Dishes | ডিম | breakfast | dim bhuna |
| `paratha_set` | Paratha Sets | পরোটা সেট | breakfast | porota |
| `borhani_doi` | Borhani & Doi | বোরহানি-দই | drinks | — |
| `lassi` | Lassi | লাচ্ছি | drinks | — |
| `cold_drinks` | Soft Drinks | কোল্ড ড্রিংকস | drinks | coke,sprite |
| `mocktail` | Mocktails | মকটেল | drinks | mojito virgin |
| `combo_family` | Family Combos | ফ্যামিলি কম্বো | set_meal | family pack |
| `party` | Party Orders | পার্টি অর্ডার | set_meal | bulk,walima |
| `iftar` | Iftar (seasonal) | ইফতার | seasonal | ramadan |
| `seasonal` | Seasonal | ঋতুভিত্তিক | — | — |
| `eid_special` | Eid Specials | ঈদ স্পেশাল | seasonal | — |
| `kids` | Kids Meals | কিডস মিল | — | children |
| `low_spice` | Low-Spice | কম ঝাল | healthy | non spicy |
| `extra_spicy` | Extra Spicy | বেশি ঝাল | — | jhal,naga |
| `naga` | Naga Specials | নাগা | extra_spicy | — |
| `cheese` | Cheesy | চিজি | fast_food | cheese |
| `local_sylhet` | Sylheti Specials | সিলেটি | bangladeshi | sylhet,satkora |
| `satkora` | Satkora Beef | সাতকড়া গরু | local_sylhet | — |
| `chattogram` | Chattogram Specials | চট্টগ্রাম | bangladeshi | mezbani |
| `mezbani` | Mezbani | মেজবানি | chattogram | — |
| `khulna` | Khulna Specials | খুলনা | bangladeshi | chui jhal |
| `chui` | Chui Jhal | চুই ঝাল | khulna | — |
| `rajshahi` | Rajshahi Specials | রাজশাহী | bangladeshi | kalai ruti |
| `global` | World Kitchen | বিশ্ব খাবার | — | fusion |
| `fusion` | Fusion | ফিউশন | global | — |
| `budget` | Budget Bites | সাশ্রয়ী | — | cheap eats,under 100 |
| `premium` | Premium | প্রিমিয়াম | — | — |