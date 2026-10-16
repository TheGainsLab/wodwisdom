-- Tap-to-define glossary moves to the database so publishing a paper can
-- merge its glossary_candidates automatically (first definition wins,
-- alternates recorded for editorial reconciliation). Seeded verbatim from
-- src/data/knowledge/glossary.json, which stays as the founding archive.

CREATE TABLE knowledge_glossary (
  term_key text PRIMARY KEY,
  term text NOT NULL,
  definition text NOT NULL,
  status text NOT NULL DEFAULT 'candidate',
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  alt_definitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE knowledge_glossary ENABLE ROW LEVEL SECURITY;

CREATE POLICY kg_select_all ON knowledge_glossary FOR SELECT USING (true);
CREATE POLICY kg_admin_insert ON knowledge_glossary FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY kg_admin_update ON knowledge_glossary FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));


INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$1rm$kg$, $kg$1RM$kg$, $kg$The heaviest load you can lift once with good form; training loads are set as a percentage of it.$kg$, 'candidate', $kg$["storey-smith-2012"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$2 3 dpg$kg$, $kg$2,3-DPG$kg$, $kg$A compound in red cells that makes haemoglobin release oxygen more readily; rises in anaemia and at altitude.$kg$, 'candidate', $kg$["biro-oxygen-cascade"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$absolute vs relative intensity$kg$, $kg$Absolute vs relative intensity$kg$, $kg$Absolute intensity is the actual workload (watts or pace); relative intensity is that workload as a percentage of a person's own maximum. After training, the same absolute workload is a lower relative intensity.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$accumulated oxygen deficit aod$kg$, $kg$Accumulated oxygen deficit (AOD)$kg$, $kg$The gap between the oxygen a hard effort would need and the oxygen actually used, added up over the effort. Used as an estimate of how much energy came from anaerobic sources.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$adp$kg$, $kg$ADP$kg$, $kg$What's left when ATP is spent; its rise is the signal that tells mitochondria to make more ATP.$kg$, 'candidate', $kg$["conley-2001"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$adrenaline epinephrine catecholamines$kg$, $kg$Adrenaline (epinephrine) / catecholamines$kg$, $kg$Stress hormones that rise with hard exercise; adrenaline speeds the breakdown of muscle glycogen. Catecholamines is the group name for adrenaline and noradrenaline.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$aerobic oxidative system$kg$, $kg$Aerobic (oxidative) system$kg$, $kg$Making ATP with oxygen from carbohydrate and fat; slower to start but almost unlimited capacity.$kg$, 'candidate', $kg$["gastin-2001"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$all out test$kg$, $kg$All-out test$kg$, $kg$A test in which the athlete goes as hard as possible from the start for a set time or until power drops below a cut-off, so power is high early and fades.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$anaerobic capacity$kg$, $kg$Anaerobic capacity$kg$, $kg$The total amount of energy a person can produce without oxygen (from phosphocreatine and glycolysis) before that supply is used up.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$area under the curve auc$kg$, $kg$Area under the curve (AUC)$kg$, $kg$The total amount of something (here blood glucose or insulin) over the length of a test, rather than its value at one moment.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$atp$kg$, $kg$ATP$kg$, $kg$The molecule muscles spend for every contraction; it's stored in tiny amounts and must be remade constantly.$kg$, 'candidate', $kg$["gastin-2001"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$beta had$kg$, $kg$Beta-HAD$kg$, $kg$An enzyme in the pathway muscle uses to burn fat; its activity is used as a marker of fat-burning capacity.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$blood lactate peak$kg$, $kg$Blood lactate (peak)$kg$, $kg$The highest lactate concentration measured in blood after a hard effort; a rough marker of how much glycolysis was used.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$buffering$kg$, $kg$Buffering$kg$, $kg$The muscle's capacity to absorb acid; improves with training.$kg$, 'candidate', $kg$["conley-2001"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$capillary density$kg$, $kg$Capillary density$kg$, $kg$How many small blood vessels surround each fibre; more means faster delivery of oxygen and removal of acid.$kg$, 'candidate', $kg$["conley-2001"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$cardiac output$kg$, $kg$Cardiac output$kg$, $kg$Litres of blood the heart pumps per minute = heart rate × stroke volume.$kg$, 'candidate', $kg$["biro-oxygen-cascade"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$citrate synthase$kg$, $kg$Citrate synthase$kg$, $kg$An enzyme found inside mitochondria; how active it is in a muscle sample is used as a marker of how much mitochondria the muscle has.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$constant intensity test to exhaustion$kg$, $kg$Constant-intensity test (to exhaustion)$kg$, $kg$A test in which the workload is fixed in advance and the rider holds it until they can no longer keep the required cadence.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$control group$kg$, $kg$Control group$kg$, $kg$Participants who do not get the training, so that changes from simply being in the study or the passage of time can be separated from the effect of training.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$correlation coefficient r$kg$, $kg$Correlation coefficient (r)$kg$, $kg$A number from −1 to 1 describing how closely two measures rise or fall together; 0 means no straight-line relationship.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$countermovement jump$kg$, $kg$Countermovement jump$kg$, $kg$A vertical jump with a quick dip first; the standard test of lower-body power.$kg$, 'candidate', $kg$["malisoux-2006"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$creatine kinase$kg$, $kg$Creatine kinase$kg$, $kg$The enzyme that moves phosphate between PCr and ATP.$kg$, 'candidate', $kg$["shulman-2005"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$cross sectional area csa$kg$, $kg$Cross-sectional area (CSA)$kg$, $kg$The thickness of a muscle or fibre; the main driver of how much force it can produce.$kg$, 'candidate', $kg$["malisoux-2006"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$crossover point$kg$, $kg$Crossover point$kg$, $kg$The exercise intensity above which carbohydrate supplies more of the body's energy than fat does.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$csi insulin sensitivity index$kg$, $kg$CSI (insulin sensitivity index)$kg$, $kg$A number calculated from a 50-minute IVGTT that summarises insulin sensitivity; higher is better.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$diffusion$kg$, $kg$Diffusion$kg$, $kg$Passive movement of a gas from high to low pressure — how oxygen crosses from air to blood and blood to cell.$kg$, 'candidate', $kg$["biro-oxygen-cascade"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$douglas bag breath by breath gas analysis$kg$, $kg$Douglas bag / breath-by-breath gas analysis$kg$, $kg$Two ways to measure oxygen uptake: collecting expired air in large bags for analysis, or analysing each breath continuously with a metabolic cart.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$effect size$kg$, $kg$Effect size$kg$, $kg$How big a difference is, independent of whether it's statistically significant; "trivial" means too small to matter.$kg$, 'candidate', $kg$["escalante-barakat-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$efficiency relationship oxygen cost extrapolation$kg$, $kg$Efficiency relationship (oxygen cost extrapolation)$kg$, $kg$A straight line linking power output to oxygen use, built from several easier rides and extended upward to estimate the oxygen a supramaximal effort would need.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$electron transport chain$kg$, $kg$Electron transport chain$kg$, $kg$The set of protein complexes inside mitochondria that use oxygen to make usable energy; their amount is another marker of mitochondrial content.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$energy balance calorie deficit$kg$, $kg$Energy balance / calorie deficit$kg$, $kg$Calories in minus calories out; fat loss over time requires a sustained deficit.$kg$, 'candidate', $kg$["escalante-barakat-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$ex vivo perfused preparation$kg$, $kg$Ex vivo / perfused preparation$kg$, $kg$A tissue removed from the animal and kept alive artificially so it can be measured precisely; precise, but not the same as a living body.$kg$, 'candidate', $kg$["kushmerick-1992"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$fast twitch fibre percentage muscle biopsy$kg$, $kg$Fast-twitch fibre percentage (muscle biopsy)$kg$, $kg$The share of fast-twitch fibres in a small muscle sample removed with a needle, here from the outer thigh (vastus lateralis).$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$fasted cardio$kg$, $kg$Fasted cardio$kg$, $kg$Aerobic exercise done after an overnight fast, before eating.$kg$, 'candidate', $kg$["escalante-barakat-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$fat oxidation$kg$, $kg$Fat oxidation$kg$, $kg$Burning fat for energy at a given moment; not the same as losing body fat over time.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$fat oxidation vs fat loss$kg$, $kg$Fat oxidation vs fat loss$kg$, $kg$Fat oxidation is fat burned right now; fat loss is the change in body fat over time, which depends on total energy balance.$kg$, 'candidate', $kg$["escalante-barakat-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$fatigue index$kg$, $kg$Fatigue index$kg$, $kg$How much power falls during an all-out test, from the peak to the minimum, expressed as a percentage of the peak.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$first order kinetics$kg$, $kg$First-order kinetics$kg$, $kg$A simple exponential recovery — the same fraction restored each minute.$kg$, 'candidate', $kg$["kushmerick-1992"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$free fatty acids ffa$kg$, $kg$Free fatty acids (FFA)$kg$, $kg$Fat molecules released from fat stores into the blood, where muscles can take them up and burn them.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$gluconeogenesis$kg$, $kg$Gluconeogenesis$kg$, $kg$The liver making new glucose from other molecules, including lactate.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$glut4$kg$, $kg$GLUT4$kg$, $kg$A protein that moves sugar from the blood into muscle cells; more of it helps muscle take up glucose.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$glycogen$kg$, $kg$Glycogen$kg$, $kg$The stored form of carbohydrate, kept in muscles and the liver.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$glycogen sparing$kg$, $kg$Glycogen sparing$kg$, $kg$Using less stored muscle carbohydrate for the same exercise, usually because another fuel such as fat or blood sugar covers more of the demand.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$glycogenolysis$kg$, $kg$Glycogenolysis$kg$, $kg$Breaking glycogen down into glucose units to make ATP fast.$kg$, 'candidate', $kg$["shulman-2005"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$glycolysis$kg$, $kg$Glycolysis$kg$, $kg$Breaking down carbohydrate without oxygen to make ATP quickly; produces lactate.$kg$, 'candidate', $kg$["gastin-2001"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$haemoglobin$kg$, $kg$Haemoglobin$kg$, $kg$The protein in red blood cells that carries almost all the oxygen in blood.$kg$, 'candidate', $kg$["biro-oxygen-cascade"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$homa ir$kg$, $kg$HOMA-IR$kg$, $kg$An estimate of insulin resistance worked out from a single fasting blood glucose and insulin value; higher means more resistant.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$hybrid fibres$kg$, $kg$Hybrid fibres$kg$, $kg$Fibres containing more than one myosin type (e.g. IIa/IIx); common and intermediate in properties.$kg$, 'candidate', $kg$["malisoux-2006"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$hypertrophy$kg$, $kg$Hypertrophy$kg$, $kg$Growth in muscle fibre size.$kg$, 'candidate', $kg$["storey-smith-2012"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$hypohydration$kg$, $kg$Hypohydration$kg$, $kg$Being short of body water, usually deliberately before a weigh-in.$kg$, 'candidate', $kg$["storey-smith-2012"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$hypoxia$kg$, $kg$Hypoxia$kg$, $kg$Oxygen supply inadequate for demand, at the tissue or cell level.$kg$, 'candidate', $kg$["biro-oxygen-cascade"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$inorganic phosphate pi$kg$, $kg$Inorganic phosphate (Pi)$kg$, $kg$What's released when PCr or ATP is spent; rises during work and is linked to fatigue.$kg$, 'candidate', $kg$["kushmerick-1992"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$insulin sensitivity$kg$, $kg$Insulin sensitivity$kg$, $kg$How strongly the body responds to insulin by clearing sugar from the blood; higher sensitivity means less insulin is needed for the same effect.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$intracellular ph h$kg$, $kg$Intracellular pH / H+$kg$, $kg$Acidity inside the muscle fibre; falls (acid rises) with hard work and interferes with energy signalling.$kg$, 'candidate', $kg$["conley-2001"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$intramuscular triglyceride$kg$, $kg$Intramuscular triglyceride$kg$, $kg$Fat stored inside muscle fibres; a fuel for moderate exercise, especially when fasted.$kg$, 'candidate', $kg$["escalante-barakat-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$intravenous glucose tolerance test ivgtt$kg$, $kg$Intravenous glucose tolerance test (IVGTT)$kg$, $kg$A test in which sugar is given directly into a vein and blood is sampled repeatedly to see how quickly the body clears it and how much insulin it releases.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$isokinetic ergometer$kg$, $kg$Isokinetic ergometer$kg$, $kg$An exercise machine that holds cadence at a fixed speed (here 90 rpm) however hard the rider pushes, so only the force and power change.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$isotope tracer$kg$, $kg$Isotope tracer$kg$, $kg$A labelled version of a molecule, such as a fatty acid or glucose, infused into the blood so researchers can track how fast that fuel is released and used.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$lactate shuttle$kg$, $kg$Lactate shuttle$kg$, $kg$The idea (Brooks) that lactate made in one place is carried to another and burned as fuel.$kg$, 'candidate', $kg$["shulman-2005"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$lactate threshold$kg$, $kg$Lactate threshold$kg$, $kg$The exercise intensity at which lactate starts building up in the blood faster than the body can clear it.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$left ventricular hypertrophy$kg$, $kg$Left ventricular hypertrophy$kg$, $kg$Thickening of the heart's main pumping chamber; a problem in disease, but proportional growth with body size in athletes is normal.$kg$, 'candidate', $kg$["storey-smith-2012"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$mcardle s disease$kg$, $kg$McArdle's disease$kg$, $kg$A genetic condition in which muscle can't break down glycogen; sufferers tire and cramp quickly.$kg$, 'candidate', $kg$["shulman-2005"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$met metabolic equivalent$kg$, $kg$MET (metabolic equivalent)$kg$, $kg$A unit of exercise intensity where 1 MET is the energy used sitting at rest; 'MET-minutes' multiplies intensity by time.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$meta analysis$kg$, $kg$Meta-analysis$kg$, $kg$A study that pools the results of many studies to get a more reliable overall answer.$kg$, 'candidate', $kg$["escalante-barakat-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$mitochondria$kg$, $kg$Mitochondria$kg$, $kg$The parts of a cell that use oxygen to produce energy; more of them means muscle can do more aerobic work.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$moderate intensity continuous training mict$kg$, $kg$Moderate-intensity continuous training (MICT)$kg$, $kg$Steady exercise held at a moderate effort for a long block, such as 45 minutes of cycling at about 70% of max heart rate.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$mtor ampk$kg$, $kg$mTOR / AMPK$kg$, $kg$Two opposing cell signals: mTOR drives growth; AMPK responds to endurance-type stress and can dampen it.$kg$, 'candidate', $kg$["travis-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$muscle biopsy$kg$, $kg$Muscle biopsy$kg$, $kg$A small sample of muscle taken with a needle to measure its contents.$kg$, 'candidate', $kg$["gastin-2001", "gillen-2016"]$kg$::jsonb, $kg$[{"entry": "gillen-2016", "definition": "A small piece of muscle (here about 100 mg from the outer thigh) removed with a needle under local anaesthetic for lab analysis."}]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$mvc$kg$, $kg$MVC$kg$, $kg$Maximal voluntary contraction; low-intensity exercise is often set as a % of it.$kg$, 'candidate', $kg$["shulman-2005"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$myofibrillar vs sarcoplasmic hypertrophy$kg$, $kg$Myofibrillar vs sarcoplasmic hypertrophy$kg$, $kg$Growth of the force-producing filaments vs growth of the fluid and non-contractile contents of the fibre; both make muscle bigger, only the first makes it proportionally stronger.$kg$, 'candidate', $kg$["travis-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$nmr mrs$kg$, $kg$NMR / MRS$kg$, $kg$Magnetic-resonance measurement of chemicals (PCr, ATP, glycogen) inside living muscle without a biopsy.$kg$, 'candidate', $kg$["shulman-2005"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$oxidative phosphorylation$kg$, $kg$Oxidative phosphorylation$kg$, $kg$The mitochondrial process that makes ATP using oxygen.$kg$, 'candidate', $kg$["conley-2001"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$oxygen debt$kg$, $kg$Oxygen debt$kg$, $kg$The old idea that extra oxygen breathed after exercise "repays" anaerobic energy; discredited as a measure.$kg$, 'candidate', $kg$["gastin-2001"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$oxygen dissociation curve$kg$, $kg$Oxygen dissociation curve$kg$, $kg$The S-shaped relationship between oxygen pressure and how much haemoglobin is carrying; its shape lets blood load in the lungs and unload in muscle.$kg$, 'candidate', $kg$["biro-oxygen-cascade"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$oxygen extraction$kg$, $kg$Oxygen extraction$kg$, $kg$The fraction of delivered oxygen that tissues actually take; ~25% at rest for the body, ~60% for the heart.$kg$, 'candidate', $kg$["biro-oxygen-cascade"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$pcr recovery half time$kg$, $kg$PCr recovery half-time$kg$, $kg$How long it takes to refill half the spent phosphocreatine after effort — a marker of mitochondrial capacity and a guide to rest intervals.$kg$, 'candidate', $kg$["kushmerick-1992"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$pennation angle$kg$, $kg$Pennation angle$kg$, $kg$The angle fibres sit at relative to the line of pull; increases with hypertrophy and raises force at some cost to speed.$kg$, 'candidate', $kg$["travis-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$periodization$kg$, $kg$Periodization$kg$, $kg$Planning training in phases (preparation, competition, transition) that vary volume and intensity.$kg$, 'candidate', $kg$["storey-smith-2012"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$phase potentiation$kg$, $kg$Phase potentiation$kg$, $kg$Ordering training blocks so each one sets up the next (e.g. hypertrophy → strength → power).$kg$, 'candidate', $kg$["travis-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$phosphocreatine pcr$kg$, $kg$Phosphocreatine (PCr)$kg$, $kg$A fast backup store that remakes ATP in the first seconds of hard effort; nearly empty after ~10–20 s of all-out work.$kg$, 'candidate', $kg$["gastin-2001"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$plyometrics$kg$, $kg$Plyometrics$kg$, $kg$Jump-based training that exploits the stretch-shortening cycle.$kg$, 'candidate', $kg$["malisoux-2006"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$protein enhanced cardio$kg$, $kg$Protein-enhanced cardio$kg$, $kg$Cardio done after a protein-only feed (e.g. 25 g whey or casein).$kg$, 'candidate', $kg$["escalante-barakat-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$randomised$kg$, $kg$Randomised$kg$, $kg$Assigned to groups by chance, which protects against the groups differing in ways the researchers did not measure; this paper says participants were matched and assigned, not randomised.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$rate of force development$kg$, $kg$Rate of force development$kg$, $kg$How fast force rises after a contraction starts; the key quality in explosive lifts, where peak force arrives in a quarter of a second.$kg$, 'candidate', $kg$["storey-smith-2012"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$regional hypertrophy$kg$, $kg$Regional hypertrophy$kg$, $kg$Growth concentrated in one part of a muscle, depending on the exercise and range of motion.$kg$, 'candidate', $kg$["travis-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$respiratory exchange ratio r or rer$kg$, $kg$Respiratory exchange ratio (R or RER)$kg$, $kg$The ratio of carbon dioxide breathed out to oxygen taken in; lower values mean more fat is being burned, higher values mean more carbohydrate.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$rpe rating of perceived exertion$kg$, $kg$RPE (rating of perceived exertion)$kg$, $kg$A person's own rating of how hard exercise feels; here on the Borg 6-20 scale, where 13 is 'somewhat hard' and 16 is between 'hard' and 'very hard'.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$sarcomeres in series in parallel$kg$, $kg$Sarcomeres in series / in parallel$kg$, $kg$More in parallel = more force; more in series = more speed and range.$kg$, 'candidate', $kg$["travis-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$sedentary$kg$, $kg$Sedentary$kg$, $kg$Doing little physical activity; here defined as scoring under 600 MET-minutes per week on a standard activity questionnaire.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$sem standard error of the mean$kg$, $kg$SEM (standard error of the mean)$kg$, $kg$A measure of how precisely a group average is known; it is smaller than the spread between individuals, so ± SEM values look tighter than the real person-to-person variation.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$shortening velocity v0$kg$, $kg$Shortening velocity (V0)$kg$, $kg$How fast a fibre contracts with no load; faster fibres make more power.$kg$, 'candidate', $kg$["malisoux-2006"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$sinclair score$kg$, $kg$Sinclair score$kg$, $kg$A formula that adjusts a weightlifting total for body weight so lifters in different classes can be compared.$kg$, 'candidate', $kg$["storey-smith-2012"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$skinned fibre$kg$, $kg$Skinned fibre$kg$, $kg$A single muscle fibre with its membrane removed so it can be activated and measured in a dish.$kg$, 'candidate', $kg$["malisoux-2006"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$specific tension$kg$, $kg$Specific tension$kg$, $kg$Force divided by fibre size; unchanged here, meaning fibres got stronger by getting bigger, not by improving quality.$kg$, 'candidate', $kg$["malisoux-2006"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$sprint interval training sit$kg$, $kg$Sprint interval training (SIT)$kg$, $kg$Short bursts of all-out effort (here 20 seconds) separated by easy recovery; a subset of high-intensity interval training.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$statistically significant$kg$, $kg$Statistically significant$kg$, $kg$A result unlikely to be due to chance alone by the study's chosen threshold (here p < 0.05); it says nothing on its own about how large or important the effect is.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$steady state$kg$, $kg$Steady state$kg$, $kg$Exercise at an intensity where PCr, pH and oxygen uptake stop drifting — sustainable for long periods.$kg$, 'candidate', $kg$["conley-2001"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$stretch shortening cycle ssc$kg$, $kg$Stretch-shortening cycle (SSC)$kg$, $kg$A fast lengthening of a muscle immediately followed by a powerful shortening — the mechanism of jumping, bounding, and plyometrics.$kg$, 'candidate', $kg$["malisoux-2006"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$stroke volume$kg$, $kg$Stroke volume$kg$, $kg$Blood ejected per heartbeat; the main thing endurance training enlarges.$kg$, 'candidate', $kg$["biro-oxygen-cascade"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$substrate$kg$, $kg$Substrate$kg$, $kg$A fuel the body breaks down for energy, mainly carbohydrate, fat and, to a small extent, protein.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$supramaximal exercise$kg$, $kg$Supramaximal exercise$kg$, $kg$Work at an intensity above the power that produces VO2max, so it cannot be supplied by aerobic metabolism alone and can only be held briefly.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$sympathetic nervous system sns$kg$, $kg$Sympathetic nervous system (SNS)$kg$, $kg$The 'fight or flight' system that ramps up during hard exercise and releases adrenaline and noradrenaline.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$testosterone cortisol ratio$kg$, $kg$Testosterone:cortisol ratio$kg$, $kg$A blood marker that tends to fall when training volume rises; used to monitor training stress.$kg$, 'candidate', $kg$["storey-smith-2012"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$training to failure$kg$, $kg$Training to failure$kg$, $kg$Continuing a set until no more reps are possible.$kg$, 'candidate', $kg$["travis-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$turnover rate of appearance$kg$, $kg$Turnover / rate of appearance$kg$, $kg$How fast a fuel such as glucose or fatty acids enters (and leaves) the blood, as opposed to its concentration at one moment.$kg$, 'candidate', $kg$["brooks-mercier-1994"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$type ii type i size ratio$kg$, $kg$Type II : type I size ratio$kg$, $kg$How much bigger fast fibres are than slow ones; higher in strength and power athletes.$kg$, 'candidate', $kg$["travis-2020"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$type iia iix fibres$kg$, $kg$Type IIA / IIX fibres$kg$, $kg$Two kinds of fast-twitch fibre; IIX are fastest but fatigue quickest, and training tends to convert IIX to IIA.$kg$, 'candidate', $kg$["storey-smith-2012"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$vo2max$kg$, $kg$VO2max$kg$, $kg$The most oxygen a person can use per minute during all-out exercise; intensities are often given as a percentage of it.$kg$, 'candidate', $kg$["brooks-mercier-1994", "gastin-1995"]$kg$::jsonb, $kg$[{"entry": "gastin-1995", "definition": "The highest rate at which a person can take up and use oxygen during exercise, usually in ml per kg body weight per minute."}]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$vo2peak$kg$, $kg$VO2peak$kg$, $kg$The highest rate of oxygen use reached in an all-out exercise test, a standard measure of aerobic fitness, usually given in millilitres per kilogram of body weight per minute.$kg$, 'candidate', $kg$["gillen-2016"]$kg$::jsonb, $kg$[]$kg$::jsonb);
INSERT INTO knowledge_glossary (term_key, term, definition, status, sources, alt_definitions) VALUES
  ($kg$wingate test$kg$, $kg$Wingate test$kg$, $kg$A standard 30 s all-out cycling test against a fixed resistance set from body weight, used to measure peak and mean anaerobic power.$kg$, 'candidate', $kg$["gastin-1995"]$kg$::jsonb, $kg$[]$kg$::jsonb);
