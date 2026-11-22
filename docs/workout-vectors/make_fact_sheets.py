"""Step 4, part 1: one fact sheet per computable Open workout (men's RX).
Every value is from the competition service's catalog (pulled 2026-11-22).
Work figures were dropped on 2026-11-22: a test showed they did not change
the AI's vectors beyond draft noise. Nothing here is a judgment.

Entry: (movement, quantity, load_lb, work_share_pct[, rest_after_s])
quantity: int = reps; ('cal', n) = calories; ('ft', n) / ('m', n) = distance;
          ('pattern', text) = no fixed number: the rep pattern as officially described
"""
import json
BW_LB = 84 / 0.45359237          # the service's standard body mass, in pounds
C2B, T2B, DU, WB = 'Chest-to-Bar Pull-up', 'Toes-to-Bar', 'Double-Under', 'Wall-Ball Shot'
RMU, BMU, BFB, HSPU = 'Ring Muscle-up', 'Bar Muscle-up', 'Bar-Facing Burpee', 'Handstand Push-up'
DS, BBJO, BJO, LB = 'Dumbbell Snatch', 'Burpee Box Jump-Over', 'Box Jump-Over', 'Lateral Burpee Over Dumbbell'
BOB, CJ, MBS, DL = 'Burpee Over the Bar', 'Clean and Jerk', 'Med Ball Box Step', 'Deadlift'
def A(sec): return dict(format='amrap', duration_seconds=sec)
def T(cap): return dict(format='for_time', time_cap_seconds=cap)
def AW(sec): return dict(format='amrap', duration_seconds=sec, reps_are='whole workout')   # fixed clock, one pass
UP3 = ('pattern', 'ascending each round: 3, 6, 9, 12 and so on, adding 3 every round until time runs out')
MAX = ('pattern', 'as many as possible in the time remaining')
W = {
 '11.6': (AW(420), None, [('Thruster',UP3,100,None),(C2B,UP3,None,None)]),
 '12.1': (AW(420), None, [('Burpee',('pattern','as many as possible for the whole 7 minutes'),None,None)]),
 '12.2': (AW(600), None, [('Snatch',30,75,None),('Snatch',30,135,None),('Snatch',30,165,None),('Snatch',MAX,210,None)]),
 '13.1': (AW(1020), None, [('Burpee',40,None,None),('Snatch',30,75,None),('Burpee',30,None,None),('Snatch',30,135,None),('Burpee',20,None,None),('Snatch',30,165,None),('Burpee',10,None,None),('Snatch',MAX,210,None)]),
 '13.4': (AW(420), None, [(CJ,UP3,135,None),(T2B,UP3,None,None)]),
 '15.4': (AW(480), None, [(HSPU,UP3,None,None),('Clean',('pattern','3 per round for rounds 1 to 3, 6 for rounds 4 to 6, 9 for rounds 7 to 9, adding 3 every third round'),185,None)]),
 '25.1': (AW(900), None, [(LB,UP3,None,None),('DB Clean and Jerk',UP3,50,None),('Walking Lunge',('ft',30),None,None)]),
 '11.1': (A(600), 46836.3, [(DU,30,None,15.57),('Snatch',15,75,84.43)]),
 '11.2': (A(900), 34256.6, [(DL,9,155,34.59),('Push-up',12,None,5.54),('Box Jump',15,None,59.87)]),
 '11.3': (A(300), 6163.0, [('Clean',1,165,68.63),('Jerk',1,165,31.37)]),
 '11.4': (A(600), 183845.0, [(BFB,60,None,43.89),('Overhead Squat',30,120,39.01),(RMU,10,None,17.1)]),
 '11.5': (A(1200), 45823.6, [('Clean',5,145,40.74),(T2B,10,None,10.63),(WB,15,20,48.63)]),
 '12.3': (A(1080), 39912.1, [('Box Jump',15,None,51.38),('Push Press',12,115,37.63),(T2B,9,None,10.99)]),
 '12.4': (A(720), 339033.8, [(WB,150,20,65.72),(DU,90,None,6.45),(RMU,30,None,27.82)]),
 '13.2': (A(600), 35281.1, [('Shoulder to Overhead',5,115,17.74),(DL,10,115,24.13),('Box Jump',15,None,58.13)]),
 '13.5': (A(240), 65621.8, [('Thruster',15,100,67.37),(C2B,15,None,32.63)]),
 '14.3': (A(480), 552915.4, [(DL,10,135,1.95),('Box Jump',15,None,3.71),(DL,15,185,4.62),('Box Jump',15,None,3.71),(DL,20,225,8.21),('Box Jump',15,None,3.71),(DL,25,275,13.75),('Box Jump',15,None,3.71),(DL,30,315,20.12),('Box Jump',15,None,3.71),(DL,35,365,29.1),('Box Jump',15,None,3.71)]),
 '14.4': (A(840), 293585.7, [('Row',('cal',60),None,14.31),(T2B,50,None,8.3),(WB,40,20,20.24),('Clean',30,135,35.73),(RMU,20,None,21.42)]),
 '14.5': (T(None), 350814.2, [('Thruster',84,95,67.8),('Burpee',84,None,32.2)]),
 '15.1': (A(540), 34600.8, [(T2B,15,None,21.13),(DL,10,115,24.61),('Snatch',5,115,54.27)]),
 '15.3': (A(840), 120594.1, [(RMU,7,None,18.25),(WB,50,20,61.59),(DU,100,None,20.16)]),
 '16.2': (T(1200), 428807.1, [(T2B,25,None,2.84),(DU,50,None,2.83),('Clean',15,135,12.23),(T2B,25,None,2.84),(DU,50,None,2.83),('Clean',13,185,14.41),(T2B,25,None,2.84),(DU,50,None,2.83),('Clean',11,225,15.09),(T2B,25,None,2.84),(DU,50,None,2.83),('Clean',9,275,15.59),(T2B,25,None,2.84),(DU,50,None,2.83),('Clean',7,315,14.3)]),
 '16.3': (A(420), 35795.9, [('Snatch',10,75,73.65),(BMU,3,None,26.35)]),
 '16.4': (A(780), 325487.1, [(DL,55,225,38.33),(WB,55,20,25.1),('Row',('cal',55),None,11.83),(HSPU,55,None,24.74)]),
 '17.1': (T(1200), 558834.4, [(DS,10,50,4.74),(BBJO,15,None,5.78),(DS,20,50,9.48),(BBJO,15,None,5.78),(DS,30,50,14.22),(BBJO,15,None,5.78),(DS,40,50,18.97),(BBJO,15,None,5.78),(DS,50,50,23.71),(BBJO,15,None,5.78)]),
 '17.3': (T(1440), 565472.7, [(C2B,18,None,4.54),('Snatch',18,95,10.09),(C2B,21,None,5.3),('Snatch',15,135,11.65),(C2B,24,None,6.06),('Snatch',12,185,13.09),(C2B,27,None,6.82),('Snatch',9,225,12.36),(C2B,30,None,7.57),('Snatch',6,245,9.14),(C2B,33,None,8.33),('Snatch',3,265,5.04)]),
 '17.5': (T(2400), 339919.5, [('Thruster',90,95,74.97),(DU,350,None,25.03)]),
 '18.1': (A(1200), 38374.6, [(T2B,8,None,10.16),('DB Clean and Jerk',10,50,64.3),('Row',('cal',14),None,25.54)]),
 '18.3': (T(840), 544492.5, [(DU,200,None,8.93),('Overhead Squat',40,115,17.1),(DU,200,None,8.93),(RMU,24,None,13.86),(DU,200,None,8.93),(DS,40,50,19.47),(DU,200,None,8.93),(BMU,24,None,13.86)]),
 '18.4': (T(540), 341009.1, [(DL,21,225,13.97),(HSPU,21,None,9.02),(DL,15,225,9.98),(HSPU,15,None,6.44),(DL,9,225,5.99),(HSPU,9,None,3.86),(DL,21,315,22.83),('Handstand Walk',('ft',50),None,0.61),(DL,15,315,16.31),('Handstand Walk',('ft',50),None,0.61),(DL,9,315,9.79),('Handstand Walk',('ft',50),None,0.61)]),
 '18.2': (T(720), None, [('Dumbbell Squat',55,50,None),(BFB,55,None,None)]),
 '19.1': (A(900), 41523.8, [(WB,19,20,67.97),('Row',('cal',19),None,32.03)]),
 '19.4': (T(720), 286219.4, [('Snatch',30,95,33.21),(BFB,36,None,16.91,180),(BMU,30,None,32.96),(BFB,36,None,16.91)]),
 '19.5': (T(1200), 447213.5, [('Thruster',105,95,66.48),(C2B,105,None,33.52)]),
 '20.2': (A(1200), 17829.7, [('DB Thruster',4,50,50.88),(T2B,6,None,16.4),(DU,24,None,32.72)]),
 '20.4': (T(1200), 620945.2, [('Box Jump',30,None,6.61),(CJ,15,95,7.65),('Box Jump',30,None,6.61),(CJ,15,135,10.61),('Box Jump',30,None,6.61),(CJ,10,185,9.94),('Pistol',30,None,7.31),(CJ,10,225,12.51),('Pistol',30,None,7.31),(CJ,5,275,8.01),('Pistol',30,None,7.31),(CJ,5,315,9.53)]),
 '20.5': (T(1200), 360037.0, [(RMU,40,None,34.94),('Row',('cal',80),None,15.55),(WB,120,20,49.51)]),
 '21.1': (T(900), None, [('Wall Walk',55,None,None),(DU,550,None,None)]),
 '21.3': (T(900), 373171.5, [('Front Squat',15,95,8.39),(T2B,30,None,3.92),('Thruster',15,95,11.38,60),('Front Squat',15,95,8.39),(C2B,30,None,11.48),('Thruster',15,95,11.38,60),('Front Squat',15,95,8.39),(BMU,30,None,25.28),('Thruster',15,95,11.38)]),
 '22.1': (A(900), None, [('Wall Walk',3,None,None),(DS,12,50,None),(BJO,15,None,None)]),
 '22.2': (T(600), 361341.0, [(DL,100,225,62.78),(BFB,100,None,37.22)]),
 '22.3': (T(720), 299165.8, [('Pull-up',21,None,7.88),(DU,42,None,3.41),('Thruster',21,95,19.88),(C2B,18,None,8.59),(DU,36,None,2.93),('Thruster',18,115,19.91),(BMU,15,None,15.77),(DU,30,None,2.44),('Thruster',15,135,19.19)]),
 '24.1': (T(900), 345268.2, [(DS,21,50,16.12),(LB,21,None,7.22),(DS,21,50,16.12),(LB,21,None,7.22),(DS,15,50,11.51),(LB,15,None,5.16),(DS,15,50,11.51),(LB,15,None,5.16),(DS,9,50,6.91),(LB,9,None,3.09),(DS,9,50,6.91),(LB,9,None,3.09)]),
 '24.2': (A(1200), 43901.2, [('Row',('m',300),None,33.48),(DL,10,185,38.83),(DU,50,None,27.69)]),
 '24.3': (T(900), 457002.9, [('Thruster',50,95,30.98),(C2B,50,None,15.62,60),('Thruster',35,135,29.32),(BMU,35,None,24.08)]),
 '25.3': (T(1200), None, [('Wall Walk',5,None,None),('Row',('cal',50),None,None),('Wall Walk',5,None,None),(DL,25,225,None),('Wall Walk',5,None,None),('Clean',25,135,None),('Wall Walk',5,None,None),('Snatch',25,95,None),('Wall Walk',5,None,None),('Row',('cal',50),None,None)]),
 '26.1': (T(720), 503364.7, [(WB,20,20,5.9),(BJO,18,None,4.89),(WB,30,20,8.85),(BJO,18,None,4.89),(WB,40,20,11.8),(MBS,18,20,3.92),(WB,66,20,19.48),(MBS,18,20,3.92),(WB,40,20,11.8),(BJO,18,None,4.89),(WB,30,20,8.85),(BJO,18,None,4.89),(WB,20,20,5.9)]),
 '26.3': (T(960), 630417.7, [(BOB,24,None,4.52),('Clean',24,95,10.02),(BOB,24,None,4.52),('Thruster',24,95,10.78),(BOB,24,None,4.52),('Clean',24,115,11.6),(BOB,24,None,4.52),('Thruster',24,115,12.6),(BOB,24,None,4.52),('Clean',24,135,13.31),(BOB,24,None,4.52),('Thruster',24,135,14.57)]),
}
REPEATS = {'12.5':'11.6','18.5':'11.6','13.3':'12.4','14.1':'11.1','16.5':'14.5','17.4':'16.4','19.2':'16.2','20.3':'18.4','21.2':'17.1','23.1':'14.4','25.2':'22.3'}
sheets = {}
for wid, (head, joules, items) in W.items():
    moves, rest_total = [], 0
    for n, it in enumerate(items, 1):
        m = {'order': n, 'movement': it[0]}
        q = it[1]
        if isinstance(q, tuple): m[{'cal': 'calories', 'ft': 'distance_ft', 'm': 'distance_m', 'pattern': 'reps_pattern'}[q[0]]] = q[1]
        else: m['reps'] = q
        if it[2] is not None:
            m['load_lb'] = it[2]; m['load_x_bodyweight'] = round(it[2] / BW_LB, 2)
        if len(it) > 4: m['rest_after_seconds'] = it[4]; rest_total += it[4]
        moves.append(m)
    sheet = dict(head)
    if 'reps_are' in head: pass
    elif head['format'] == 'amrap': sheet['reps_are'] = 'per round'
    else: sheet['reps_are'] = 'whole workout'
    sheet['rest'] = f'{rest_total} seconds built in' if rest_total else 'none'
    sheet['movements'] = moves
    sheets[wid] = sheet
json.dump(sheets, open('fact-sheets.json', 'w'), indent=1)
json.dump(REPEATS, open('fact-sheet-repeats.json', 'w'), indent=1)
print(len(sheets), 'distinct sheets;', len(sheets) + len(REPEATS), 'workouts covered')
