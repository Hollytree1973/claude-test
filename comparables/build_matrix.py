"""Build the Gibsons comparables and adjustments workbook.

Run:  python3 build_matrix.py
Writes Gibsons_Comparables_Adjustment_Matrix.xlsx next to this script.

Sheets, in order: Instructions, Subject, HPI, Comparables, Adjustments, Summary.
All visible text follows the Gibsons house style: British English, plain words,
no dashes or hyphens.
"""

import datetime as dt
import os

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.properties import PageSetupProperties

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "Gibsons_Comparables_Adjustment_Matrix.xlsx")

# ---------------------------------------------------------------- style
ORANGE = "FFFF6600"
BODY = "FF333333"
INPUT = "FFFFF2CC"      # light yellow: you type here
FORMULA = "FFE7E6E6"    # grey: worked out
EXAMPLE = "FFFCE4D6"    # peach: example to delete
FLAG = "FFFFFACD"       # pale yellow warning fill
RED = "FFCC0000"

GBP = '\\£#,##0;"(£"#,##0\\)'
PCT = '0.0%;\\(0.0%\\)'
DATE = "dd/mm/yyyy"
MONTH = "mmm\\ yyyy"
INT = "0"
DEC2 = "0.00"

thin = Side(style="thin", color="FFBFBFBF")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
med = Side(style="medium", color=ORANGE)
BOX_ORANGE = Border(left=med, right=med, top=med, bottom=med)


def font(bold=False, color=BODY, size=10):
    return Font(name="Arial", size=size, bold=bold, color=color)


def fill(rgb):
    return PatternFill("solid", fgColor=rgb)


FLAG_DXF_FONT = Font(name="Arial", color=RED)
FLAG_DXF_FILL = PatternFill(bgColor=FLAG)


def title(ws, text, sub=None):
    ws["A1"] = text
    ws["A1"].font = font(True, ORANGE, 14)
    ws.row_dimensions[1].height = 18
    if sub:
        ws["A2"] = sub
        ws["A2"].font = font()


def header(cell, text, wrap=True):
    cell.value = text
    cell.font = font(True, "FFFFFFFF")
    cell.fill = fill(ORANGE)
    cell.border = BOX
    cell.alignment = Alignment(wrap_text=wrap, vertical="center")


def label(cell, text, bold=True):
    cell.value = text
    cell.font = font(bold)
    cell.alignment = Alignment(vertical="center")


def note(cell, text, color=BODY, wrap=True):
    cell.value = text
    cell.font = font(False, color)
    cell.alignment = Alignment(wrap_text=wrap, vertical="top")


def inp(cell, value=None, fmt=None, example=False, wrap=False, border=BOX):
    cell.value = value
    cell.font = font()
    cell.fill = fill(EXAMPLE if example else INPUT)
    cell.border = border
    cell.alignment = Alignment(wrap_text=wrap, vertical="center")
    if fmt:
        cell.number_format = fmt


def calc(cell, formula, fmt=None, wrap=False):
    cell.value = formula
    cell.font = font()
    cell.fill = fill(FORMULA)
    cell.border = BOX
    cell.alignment = Alignment(wrap_text=wrap, vertical="center")
    if fmt:
        cell.number_format = fmt


def add_list(ws, sqref, items, title_text="Not in the list"):
    dv = DataValidation(
        type="list",
        formula1='"' + ",".join(items) + '"',
        allow_blank=True,
        showErrorMessage=True,
        showInputMessage=True,
        errorStyle="stop",
        errorTitle=title_text,
        error="Please pick an option from the list.",
        promptTitle="Pick from the list",
        prompt="Choose one option from the drop down list.",
    )
    ws.add_data_validation(dv)
    dv.add(sqref)
    return dv


def add_number(ws, sqref, kind, low, high, error, prompt=None):
    dv = DataValidation(
        type=kind,
        operator="between",
        formula1=str(low),
        formula2=str(high),
        allow_blank=True,
        showErrorMessage=True,
        showInputMessage=bool(prompt),
        errorStyle="stop",
        errorTitle="Check the figure",
        error=error,
        promptTitle="Your entry" if prompt else None,
        prompt=prompt,
    )
    ws.add_data_validation(dv)
    dv.add(sqref)
    return dv


def add_date(ws, sqref):
    dv = DataValidation(
        type="date",
        operator="between",
        formula1="1",
        formula2="73051",
        allow_blank=True,
        showErrorMessage=True,
        errorStyle="stop",
        errorTitle="Check the date",
        error="Please type a date as DD/MM/YYYY.",
    )
    ws.add_data_validation(dv)
    dv.add(sqref)


def flag_rule(ws, sqref, formula, bold=False):
    f = Font(name="Arial", color=RED, bold=bold)
    ws.conditional_formatting.add(
        sqref, FormulaRule(formula=[formula], font=f, fill=PatternFill(bgColor=FLAG))
    )


def page(ws, landscape=False):
    ws.page_setup.paperSize = 9
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.sheet_properties.tabColor = ORANGE


# ---------------------------------------------------------------- lists
L_PROPERTY = ["House", "Bungalow", "Flat", "Maisonette"]
L_FORM = ["Detached", "Semi detached", "Terraced", "End of terrace",
          "Purpose built block", "Converted building"]
L_PARKING = ["Garage", "Driveway", "Allocated space", "On street", "Permit only", "None"]
L_TENURE = ["Freehold", "Leasehold", "Share of freehold"]
L_EPC = list("ABCDEFG")
L_CONDITION = ["Good", "Average", "Below average", "Poor"]
L_GARDEN_SIZE = ["Large", "Average", "Small", "Communal", "None"]
L_GARDEN_ASPECT = ["South", "East", "West", "North", "Not known"]
L_AREA_SOURCE = ["EPC register", "Agent floor plan", "Measured on site", "Rightmove SCT"]
L_STATUS = ["Completed", "Under offer", "Asking"]
L_RANKING = ["1 Land Registry completed sale", "2 Agent confirmed sale",
             "3 Under offer", "4 Asking price"]
L_SALE_TYPE = ["Normal", "Auction", "Repossession", "New build"]
L_DATE_TYPE = ["Completion", "Exchange"]
L_CHECKED = ["HM Land Registry", "Selling agent", "Not checked"]
L_VALUERS = ["Andrew Gibson MRICS", "Harry Crawford Vine AssocRICS"]
L_BASIS = ["Market Value", "Market Value with special assumptions", "Market Rent", "Other"]

FIRST, LAST = 5, 16          # Comparables data rows
AFIRST, ALAST = 10, 21       # Adjustments data rows
SFIRST, SLAST = 5, 16        # Summary data rows
NCOMP = LAST - FIRST + 1

wb = Workbook()
wb.properties.creator = "Gibsons Surveyors"

# =============================================================== Subject
# Built before Instructions in code so the row map is known; sheet order is fixed at the end.
sj = wb.create_sheet("Subject")
title(sj, "Subject property",
      "EXAMPLE figures shown in peach: replace them with the real job and subject property")
for col, text in zip("ABC", ["Item", "Your entry", "Guidance"]):
    header(sj[f"{col}3"], text)

SUBJ = {}   # key -> row
subject_rows = [
    ("section", "About the job"),
    ("client", "Client or lender", "EXAMPLE Sample Bank plc", None, None,
     "Who the valuation is for"),
    ("jobref", "Job reference", "EXAMPLE GS 2026 0001", None, None, "Gibsons job or report reference"),
    ("purpose", "Purpose of valuation", "EXAMPLE Secured lending", None, None,
     "For example purchase, secured lending, probate"),
    ("valdate", "Valuation date", dt.datetime(2026, 11, 2), DATE, "date",
     "Inspection date as standard; date of death for probate; the historic date for capital gains or matrimonial work"),
    ("basis", "Basis of value", "Market Value", None, L_BASIS, "Pick from the list"),
    ("inspdate", "Inspection date", dt.datetime(2026, 11, 2), DATE, "date",
     "The day you inspected. Can differ from the valuation date"),
    ("valuer", "Valuer", "Andrew Gibson MRICS", None, L_VALUERS,
     "Pick from the list. Harry's work is reviewed by Andrew: record the review below"),
    ("prepared", "Prepared on", dt.datetime(2026, 11, 2), DATE, "date", "The date this matrix was prepared"),
    ("reviewer", "Reviewed by", None, None, L_VALUERS, "Pick from the list once the review is done"),
    ("revdate", "Date reviewed", None, DATE, "date", "Date of the review"),
    ("section", "About the property"),
    ("address", "Address", "EXAMPLE 14 Example Avenue, Chelmsford", None, None, "Full address"),
    ("postcode", "Postcode", "CM2 9ZZ", None, None, "Fictional example postcode"),
    ("la", "Local authority", "Chelmsford", None, None, "Used to choose the right HPI series"),
    ("ptype", "Property type", "House", None, L_PROPERTY, "Pick from the list"),
    ("form", "Built form", "Semi detached", None, L_FORM, "Pick from the list"),
    ("beds", "Bedrooms", 3, INT, None, None),
    ("baths", "Bathrooms", 1, INT, None, None),
    ("recep", "Reception rooms", 2, INT, None, None),
    ("area", "Floor area (square metres)", 95, INT, None,
     "From the Energy Performance Certificate (EPC) or your own measurement. Use the same basis for every comparable"),
    ("areaft", "Floor area (square feet)", "calc", "#,##0", None,
     "Worked out for you (1 square metre = 10.764 square feet)"),
    ("areasrc", "Floor area source", "EPC register", None, L_AREA_SOURCE,
     "Pick from the list. Comparables with a different source are flagged"),
    ("gsize", "Garden size", "Average", None, L_GARDEN_SIZE, "Pick from the list"),
    ("gaspect", "Garden aspect", "South", None, L_GARDEN_ASPECT, "Direction the main garden faces"),
    ("parking", "Parking", "Driveway", None, L_PARKING, "Pick from the list"),
    ("tenure", "Tenure", "Freehold", None, L_TENURE, "Pick from the list"),
    ("lease", "Lease years left", None, INT, None, "Only for leasehold. Under 80 years is flagged"),
    ("epc", "EPC band", "D", None, L_EPC, "Pick from the list"),
    ("condition", "Condition", "Average", None, L_CONDITION, "Pick from the list"),
    ("notes", "Notes", "EXAMPLE only. Typical 1930s semi detached house, kitchen refitted 2019", None, None,
     "Special features or defects"),
]
r = 4
for item in subject_rows:
    if item[0] == "section":
        c = sj[f"A{r}"]
        c.value = item[1]
        c.font = font(True, ORANGE)
        r += 1
        continue
    key, text, value, fmt, rule, guide = item
    SUBJ[key] = r
    label(sj[f"A{r}"], text)
    if value == "calc":
        calc(sj[f"B{r}"], None, fmt)
    else:
        inp(sj[f"B{r}"], value, fmt, example=value is not None)
    if isinstance(rule, list):
        add_list(sj, f"B{r}", rule)
    elif rule == "date":
        add_date(sj, f"B{r}")
    if guide:
        note(sj[f"C{r}"], guide)
    r += 1
SUBJ_LAST = r - 1
sj[f"B{SUBJ['areaft']}"] = f'=IF(N(B{SUBJ["area"]})=0,"",B{SUBJ["area"]}*10.764)'
for key in ("beds", "baths", "recep", "lease"):
    add_number(sj, f"B{SUBJ[key]}", "whole", 0, 999, "Please type a whole number.")
add_number(sj, f"B{SUBJ['area']}", "decimal", 0, 100000, "Please type the floor area in square metres.")
sj.column_dimensions["A"].width = 30
sj.column_dimensions["B"].width = 42
sj.column_dimensions["C"].width = 75
sj.freeze_panes = "A4"
page(sj)


def S(key):
    """Absolute reference to a Subject entry."""
    return f"Subject!$B${SUBJ[key]}"


VAL = S("valdate")
SAREA = S("area")

# =============================================================== HPI
hp = wb.create_sheet("HPI")
title(hp, "UK House Price Index (UK HPI) for the time adjustment",
      "EXAMPLE index figures below are made up. Replace them with the UK HPI series for the local authority and property type")
label(hp["A4"], "HPI series used")
inp(hp["B4"], "EXAMPLE Chelmsford, Semi detached", example=True)
label(hp["A5"], "Release date of the HPI data used")
inp(hp["B5"], "EXAMPLE November 2026 release", example=True)
label(hp["A6"], "Date you downloaded it")
inp(hp["B6"], dt.datetime(2026, 11, 2), DATE, example=True)
add_date(hp, "B6")
HF, HL = 16, 135
B_RNG = f"$B${HF}:$B${HL}"
C_RNG = f"$C${HF}:$C${HL}"
E_RNG = f"$E${HF}:$E${HL}"
label(hp["A8"], "Valuation month (from the Subject sheet)")
calc(hp["B8"], f'=IF({VAL}="","",DATE(YEAR({VAL}),MONTH({VAL}),1))', MONTH)
label(hp["A9"], "Index found for the valuation month")
calc(hp["B9"], f'=IF(B8="","",IFERROR(1/(1/INDEX({B_RNG},MATCH(B8,{C_RNG},0))),"Not published yet"))', DEC2)
label(hp["A10"], "Your own index for the valuation date (optional)")
inp(hp["B10"], None, DEC2)
add_number(hp, "B10", "decimal", 0, 100000, "Please type an index figure above 0.")
note(hp["D10"], "Leave blank to use the table. Use this if you want to set the figure yourself.", wrap=False)
LATEST = f"INDEX({B_RNG},MATCH(MAX({E_RNG}),{E_RNG},0))"
label(hp["A11"], "Index used for the valuation date")
calc(hp["B11"], f'=IF(N(B10)>0,B10,IF(MAX({E_RNG})=0,"",IF(ISNUMBER(B9),B9,{LATEST})))', DEC2)
label(hp["A12"], "Month that index relates to")
calc(hp["B12"], f'=IF(N(B10)>0,"Your own figure",IF(MAX({E_RNG})=0,"",IF(ISNUMBER(B9),B8,MAX({E_RNG}))))', MONTH)
label(hp["A13"], "Note")
hp.merge_cells("B13:D13")
calc(hp["B13"], f'=IF(AND(N(B10)=0,B9="Not published yet",MAX({E_RNG})>0),"The valuation month has no index in the table yet, so the latest month that has one is used. Any later movement is your own judgement.",IF(MAX({E_RNG})=0,"No index figures yet, so no time adjustment is made.",""))', wrap=True)
hp.row_dimensions[13].height = 30
for col, text in zip("ABCDE", ["Month (paste real dates from the UK HPI)", "Index", "Month used for matching",
                               "Notes", "Month that has an index"]):
    header(hp[f"{col}15"], text)
hp.row_dimensions[15].height = 30
EX_HPI = [101.2, 101.0, 101.5, 101.9, 102.4, 102.8, 103.1, 103.0, 102.7, 102.6, 102.9, 103.2,
          103.0, 103.4, 103.9, 104.3, 104.8, 105.1, 105.3, 105.2, 105.6]
for i, rr in enumerate(range(HF, HL + 1)):
    ex = i < len(EX_HPI)
    month = dt.datetime(2025 + (i // 12), (i % 12) + 1, 1) if ex else None
    inp(hp[f"A{rr}"], month, MONTH, example=ex)
    inp(hp[f"B{rr}"], EX_HPI[i] if ex else None, DEC2, example=ex)
    calc(hp[f"C{rr}"], f'=IF(N(A{rr})=0,"",DATE(YEAR(A{rr}),MONTH(A{rr}),1))', MONTH)
    calc(hp[f"E{rr}"], f'=IF(AND(C{rr}<>"",N(B{rr})>0),C{rr},"")', MONTH)
note(hp[f"D{HF}"], "EXAMPLE figures, not real UK HPI data", color=RED, wrap=False)
add_date(hp, f"A{HF}:A{HL}")
add_number(hp, f"B{HF}:B{HL}", "decimal", 0, 100000, "Please type an index figure above 0.")
flag_rule(hp, f"A{HF}:A{HL}", f'AND(A{HF}<>"",NOT(ISNUMBER(A{HF})))')
hp.column_dimensions["A"].width = 44
hp.column_dimensions["B"].width = 18
hp.column_dimensions["C"].width = 16
hp.column_dimensions["D"].width = 60
hp.column_dimensions["E"].width = 16
hp.freeze_panes = "A16"
page(hp)

# =============================================================== Comparables
cp = wb.create_sheet("Comparables")
title(cp, "Comparable evidence",
      "One row per comparable, up to 12. Rows 1 to 3 are EXAMPLES to delete. Yellow cells are for you; grey cells are worked out")

# key, header, width, format, list or None, input?
COMP_COLS = [
    ("no", "No.", 6, None, None, False),
    ("address", "Address", 36, None, None, True),
    ("postcode", "Postcode", 10, None, None, True),
    ("distance", "Distance from subject (miles)", 11, DEC2, None, True),
    ("status", "Evidence status", 13, None, L_STATUS, True),
    ("ranking", "Evidence ranking", 22, None, L_RANKING, True),
    ("saletype", "Type of sale", 13, None, L_SALE_TYPE, True),
    ("sold", "Sold price (£)", 13, GBP, None, True),
    ("saledate", "Sale date (see date type)", 12, DATE, "date", True),
    ("datetype", "Date type", 12, None, L_DATE_TYPE, True),
    ("checked", "Price checked with", 16, None, L_CHECKED, True),
    ("asking", "Asking price (£)", 13, GBP, None, True),
    ("listed", "Date listed (for asking prices and offers)", 13, DATE, "date", True),
    ("ptype", "Property type", 12, None, L_PROPERTY, True),
    ("form", "Built form", 15, None, L_FORM, True),
    ("beds", "Bedrooms", 9, INT, None, True),
    ("baths", "Bathrooms", 9, INT, None, True),
    ("recep", "Reception rooms", 9, INT, None, True),
    ("area", "Floor area (square metres)", 11, INT, None, True),
    ("areasrc", "Floor area source", 15, None, L_AREA_SOURCE, True),
    ("tenure", "Tenure", 13, None, L_TENURE, True),
    ("lease", "Lease years left", 9, INT, None, True),
    ("epc", "EPC band", 7, None, L_EPC, True),
    ("condition", "Condition", 13, None, L_CONDITION, True),
    ("parking", "Parking", 14, None, L_PARKING, True),
    ("gsize", "Garden size", 11, None, L_GARDEN_SIZE, True),
    ("gaspect", "Garden aspect", 11, None, L_GARDEN_ASPECT, True),
    ("source", "Source", 18, None, None, True),
    ("link", "Link", 26, None, None, True),
    ("notes", "Notes", 34, None, None, True),
    ("dateused", "Date used for time adjustment", 12, DATE, None, False),
    ("price", "Price used (£)", 13, GBP, None, False),
    ("pps", "Price per square metre (£)", 12, GBP, None, False),
    ("months", "Months from sale or listing to valuation date", 11, INT, None, False),
    ("areadiff", "Floor area difference from subject", 12, PCT, None, False),
    ("flags", "Flags to check", 50, None, None, False),
]
CC = {key: get_column_letter(i + 1) for i, (key, *_rest) in enumerate(COMP_COLS)}


def C(key, row):
    return f"{CC[key]}{row}"


EX_COMPS = [
    dict(address="EXAMPLE 22 Sample Close, Chelmsford", postcode="CM2 9ZY", distance=0.3, status="Completed",
         ranking="1 Land Registry completed sale", saletype="Normal", sold=415000,
         saledate=dt.datetime(2026, 8, 14), datetype="Completion", checked="HM Land Registry", asking=425000,
         ptype="House", form="Semi detached", beds=3, baths=1, recep=2, area=92, areasrc="EPC register",
         tenure="Freehold", epc="C", condition="Good", parking="Driveway", gsize="Average", gaspect="West",
         source="EXAMPLE Rightmove SCT", notes="EXAMPLE only, delete this row. Recently refitted kitchen"),
    dict(address="EXAMPLE 7 Specimen Road, Chelmsford", postcode="CM2 9ZX", distance=0.4, status="Completed",
         ranking="1 Land Registry completed sale", saletype="Normal", sold=398000,
         saledate=dt.datetime(2026, 5, 20), datetype="Completion", checked="HM Land Registry", asking=400000,
         ptype="House", form="Terraced", beds=3, baths=1, recep=2, area=88, areasrc="EPC register",
         tenure="Freehold", epc="D", condition="Average", parking="On street", gsize="Average", gaspect="South",
         source="EXAMPLE HM Land Registry", notes="EXAMPLE only, delete this row. Mid terrace, no parking"),
    dict(address="EXAMPLE 31 Model Way, Chelmsford", postcode="CM2 9ZW", distance=0.7, status="Completed",
         ranking="1 Land Registry completed sale", saletype="Normal", sold=452000,
         saledate=dt.datetime(2026, 3, 10), datetype="Completion", checked="HM Land Registry", asking=465000,
         ptype="House", form="Semi detached", beds=3, baths=2, recep=2, area=108, areasrc="Agent floor plan",
         tenure="Freehold", epc="C", condition="Good", parking="Garage", gsize="Large", gaspect="East",
         source="EXAMPLE Rightmove SCT", notes="EXAMPLE only, delete this row. Extended, en suite, garage"),
]

for i, (key, text, width, fmt, rule, is_input) in enumerate(COMP_COLS):
    col = get_column_letter(i + 1)
    header(cp[f"{col}4"], text)
    cp.column_dimensions[col].width = width
    rng = f"{col}{FIRST}:{col}{LAST}"
    if isinstance(rule, list):
        add_list(cp, rng, rule)
    elif rule == "date":
        add_date(cp, rng)
cp.row_dimensions[4].height = 58
add_number(cp, f"{CC['distance']}{FIRST}:{CC['distance']}{LAST}", "decimal", 0, 1000, "Please type the distance in miles.")
for key in ("beds", "baths", "recep", "lease"):
    add_number(cp, f"{CC[key]}{FIRST}:{CC[key]}{LAST}", "whole", 0, 999, "Please type a whole number.")
for key in ("sold", "asking"):
    add_number(cp, f"{CC[key]}{FIRST}:{CC[key]}{LAST}", "decimal", 0, 100000000, "Please type a price in £.")
add_number(cp, f"{CC['area']}{FIRST}:{CC['area']}{LAST}", "decimal", 0, 100000, "Please type the floor area in square metres.")

S_AREASRC = S("areasrc")
G6 = "Adjustments!$G$6"
for n, row in enumerate(range(FIRST, LAST + 1)):
    ex = EX_COMPS[n] if n < len(EX_COMPS) else {}
    for key, text, width, fmt, rule, is_input in COMP_COLS:
        cell = cp[C(key, row)]
        if is_input:
            inp(cell, ex.get(key), fmt, example=bool(ex))
    calc(cp[C("no", row)], n + 1)
    g = lambda k: C(k, row)  # noqa: E731
    calc(cp[g("dateused")],
         f'=IF(N({g("saledate")})>0,{g("saledate")},IF(AND({g("status")}<>"Completed",N({g("listed")})>0),{g("listed")},""))', DATE)
    calc(cp[g("price")], f'=IF(N({g("sold")})>0,{g("sold")},IF(N({g("asking")})>0,{g("asking")},""))', GBP)
    calc(cp[g("pps")], f'=IF(OR({g("price")}="",N({g("area")})=0),"",{g("price")}/{g("area")})', GBP)
    d = g("dateused")
    calc(cp[g("months")],
         f'=IF(OR({d}="",N({VAL})=0),"",IF({d}>{VAL},0-DATEDIF({VAL},{d},"m"),DATEDIF({d},{VAL},"m")))', INT)
    calc(cp[g("areadiff")], f'=IF(OR(N({g("area")})=0,N({SAREA})=0),"",({g("area")}-{SAREA})/{SAREA})', PCT)
    pps_col = CC["pps"]
    parts = [
        f'IF(N({g("area")})=0,"No floor area. ","")',
        f'IF(AND(N({g("area")})>0,{g("areasrc")}=""),"No floor area source. ",IF(AND({g("areasrc")}<>"",{S_AREASRC}<>"",{g("areasrc")}<>{S_AREASRC}),"Floor area source differs from the subject. ",""))',
        f'IF(AND({g("status")}="Completed",N({g("sold")})=0),"Completed but no sold price, asking price used. ","")',
        f'IF(AND({g("status")}="Completed",N({g("sold")})>0,OR({g("checked")}="",{g("checked")}="Not checked")),"Sale price not checked yet. ","")',
        f'IF(AND({g("status")}<>"",{g("status")}<>"Completed",N({g("sold")})=0,N({g("listed")})=0),"No date listed, so no time adjustment. ","")',
        f'IF({d}="","",IF({d}>{VAL},"Sale or listing after the valuation date. ","")&IF(N({g("months")})>12,"Over 12 months before the valuation date. ","")&IF({G6}=0,"Time adjustment applies, as every sale is set to be adjusted. ",IF(ABS(N({g("months")}))>{G6},"More than "&{G6}&" months from the valuation date, so a time adjustment applies. ","")))',
        f'IF(N({g("distance")})>0.5,"Over half a mile from the subject. ","")',
        f'IF(AND({g("tenure")}="Leasehold",N({g("lease")})>0,N({g("lease")})<80),"Lease under 80 years, marriage value applies. ","")',
        f'IF({g("status")}="Asking","Asking price only, not a sale. ",IF({g("status")}="Under offer","Under offer, price not confirmed. ",""))',
        f'IF(OR({g("saletype")}="Auction",{g("saletype")}="Repossession",{g("saletype")}="New build"),{g("saletype")}&" sale. ","")',
        f'IF({g("status")}="","No evidence status chosen. ","")',
        f'IF(OR({g("pps")}="",COUNT({pps_col}${FIRST}:{pps_col}${LAST})<3),"",IF(ABS({g("pps")}/MEDIAN({pps_col}${FIRST}:{pps_col}${LAST})-1)>0.15,"Price per square metre over 15% from the median. ",""))',
        f'IF({g("areadiff")}="","",IF(ABS({g("areadiff")})>0.25,"Floor area over 25% different from the subject. ",""))',
    ]
    calc(cp[g("flags")], f'=IF({g("price")}="","",TRIM(' + "&".join(parts) + "))", wrap=True)
flag_rule(cp, f"{CC['flags']}{FIRST}:{CC['flags']}{LAST}", f"LEN({CC['flags']}{FIRST})>0")
cp.freeze_panes = "C5"
page(cp, landscape=True)

# =============================================================== Adjustments
aj = wb.create_sheet("Adjustments")
title(aj, "Adjustments grid",
      "Adjust each comparable towards the subject. Comparable better than the subject: minus figure. Comparable worse: plus figure. Type a % OR a £ figure, not both")
settings = [
    (3, "Gross adjustment warning threshold", 0.15, PCT, "Warning only. RICS sets no limit. 15% to start with"),
    (4, "Single adjustment warning threshold", 0.10, PCT, "Warning when any one line is above this"),
    (5, "Include time adjustment in the gross test", "No", None, "Yes or No"),
    (6, "Time adjust sales more than this many months from the valuation date", 3, INT,
     "Gibsons method: 3. Set 0 to adjust every sale. Applies to sales before or after the valuation date"),
    (7, "Usual asking or offer discount", 0, PCT,
     "Typed as a plus figure, for example 3%. Taken off Asking and Under offer rows with no sold price, unless you type your own figure on that line. 0 switches it off"),
]
for row, text, value, fmt, guide in settings:
    label(aj[f"D{row}"], text)
    inp(aj[f"G{row}"], value, fmt)
    note(aj[f"H{row}"], guide, wrap=False)
add_number(aj, "G3:G4", "decimal", 0, 1, "Please type a percentage from 0% to 100%.")
add_list(aj, "G5", ["Yes", "No"])
add_number(aj, "G6", "whole", 0, 240, "Please type a whole number of months from 0 to 240.")
add_number(aj, "G7", "decimal", 0, 0.5, "Please type a percentage from 0% to 50%.")

FIXED = [
    ("no", "No.", 6, None), ("address", "Address", 32, None), ("status", "Evidence status", 12, None),
    ("price", "Price used (£)", 13, GBP), ("area", "Floor area (square metres)", 10, INT),
    ("hpisale", "HPI index in month of sale", 9, DEC2), ("hpival", "HPI index at valuation date", 9, DEC2),
    ("factor", "HPI factor", 9, "0.0000"), ("tprice", "Time adjusted price (£)", 13, GBP),
    ("tgbp", "Time adjustment (£)", 12, GBP), ("tpct", "Time adjustment (%)", 10, PCT),
    ("areadiff", "Floor area difference", 10, PCT), ("band", "Suggested size % (Gibsons bands, suggestion only)", 11, PCT),
]
FACTORS = [
    ("size", "Size"), ("form", "Built form"), ("beds", "Bedrooms and accommodation"), ("loc", "Location"),
    ("cond", "Condition"), ("park", "Parking"), ("garden", "Garden or plot"), ("bath", "Bathrooms"),
    ("tenure", "Tenure or lease"), ("epc", "EPC"), ("disc", "Asking or offer discount"),
    ("other", "Other (name it in the reason)"),
]
RESULTS = [
    ("total", "Total of other adjustments (£)", 13, GBP),
    ("adj", "Adjusted price (£)", 14, GBP),
    ("adjpps", "Adjusted price per square metre, before the size adjustment (£)", 13, GBP),
    ("netgbp", "Net change including time (£)", 13, GBP),
    ("netinc", "Net change including time (% of price used)", 11, PCT),
    ("netex", "Net adjustment excluding time (% of time adjusted price)", 11, PCT),
    ("gross", "Gross adjustment (% of time adjusted price; time added only if set to Yes above)", 12, PCT),
    ("largest", "Largest single adjustment (% of time adjusted price)", 11, PCT),
    ("count", "Number of adjustments", 10, INT),
    ("warn", "Warnings", 46, None),
    ("work", "Warning working (hidden)", 10, None),
]
AC = {}
col_i = 1
for key, text, width, fmt in FIXED:
    AC[key] = get_column_letter(col_i)
    col_i += 1
F_START = col_i
for key, text in FACTORS:
    for part in ("pct", "gbp", "reason", "amt"):
        AC[f"{key}_{part}"] = get_column_letter(col_i)
        col_i += 1
R_START = col_i
for key, text, width, fmt in RESULTS:
    AC[key] = get_column_letter(col_i)
    col_i += 1
A_LASTCOL = col_i - 1


def A(key, row):
    return f"{AC[key]}{row}"


# group heading row 8
aj.merge_cells(f"{AC['hpisale']}8:{AC['tpct']}8")
header(aj[f"{AC['hpisale']}8"], "Time (from the HPI sheet)")
aj.merge_cells(f"{AC['areadiff']}8:{AC['band']}8")
header(aj[f"{AC['areadiff']}8"], "Size guide")
for key, text in FACTORS:
    aj.merge_cells(f"{AC[key + '_pct']}8:{AC[key + '_amt']}8")
    header(aj[f"{AC[key + '_pct']}8"], text)
aj.merge_cells(f"{AC['total']}8:{AC['warn']}8")
header(aj[f"{AC['total']}8"], "Results")
# column headings row 9
for key, text, width, fmt in FIXED:
    header(aj[f"{AC[key]}9"], text)
    aj.column_dimensions[AC[key]].width = width
for key, text in FACTORS:
    short = text.replace(" (name it in the reason)", "")
    for part, htext, width in (("pct", f"{short} %", 9), ("gbp", f"{short} £", 11),
                               ("reason", f"{short} reason", 24), ("amt", f"{short} adjustment (£)", 12)):
        header(aj[f"{AC[key + '_' + part]}9"], htext)
        aj.column_dimensions[AC[key + "_" + part]].width = width
for key, text, width, fmt in RESULTS:
    header(aj[f"{AC[key]}9"], text)
    aj.column_dimensions[AC[key]].width = width
aj.column_dimensions[AC["work"]].hidden = True
aj.row_dimensions[9].height = 80

aj[f"{AC['band']}9"].comment = Comment(
    "Gibsons stepped bands on floor area difference: under 10% gives 0%, 10 to 20% gives 5%, 20 to 30% gives 10%, "
    "30 to 40% gives 15%, 40 to 50% gives 20%, 50% or more gives 30%. Plus when the comparable is smaller. "
    "This is a suggestion only and is never copied into Size % for you: type your own figure there. "
    "Near a band edge (for example 9.9% against 10%) use your own judgement rather than the step.",
    "Gibsons Surveyors", width=320, height=160)
aj[f"{AC['disc_pct']}9"].comment = Comment(
    "If you leave this line blank, the usual asking or offer discount set at the top of the sheet is taken off "
    "Asking and Under offer rows that have no sold price. Type your own % or £ figure here to replace it.",
    "Gibsons Surveyors", width=320, height=120)

EX_ADJ = {
    0: {"size_pct": 0, "size_reason": "EXAMPLE Floor area within 10%, no size change",
        "cond_pct": -0.03, "cond_reason": "EXAMPLE Better condition than the subject",
        "garden_pct": 0.02, "garden_reason": "EXAMPLE Subject garden faces south",
        "epc_pct": -0.01, "epc_reason": "EXAMPLE EPC C against D"},
    1: {"form_pct": 0.03, "form_reason": "EXAMPLE Terraced against semi detached",
        "loc_pct": 0.02, "loc_reason": "EXAMPLE Slightly busier road",
        "park_gbp": 10000, "park_reason": "EXAMPLE No off street parking, subject has a driveway"},
    2: {"size_pct": -0.10, "size_reason": "EXAMPLE 13.7% larger, banded figure judged too low so increased",
        "loc_pct": -0.02, "loc_reason": "EXAMPLE Quieter cul de sac position",
        "cond_pct": -0.03, "cond_reason": "EXAMPLE Better condition than the subject",
        "park_gbp": -12000, "park_reason": "EXAMPLE Garage as well as a driveway",
        "bath_gbp": -8000, "bath_reason": "EXAMPLE Has an en suite, subject has one bathroom"},
}

for n, row in enumerate(range(AFIRST, ALAST + 1)):
    crow = FIRST + n
    ex = EX_ADJ.get(n, {})
    a = lambda k: A(k, row)  # noqa: E731
    cref = lambda k: f"Comparables!{C(k, crow)}"  # noqa: E731
    D_ = a("price")
    calc(aj[a("no")], f"={cref('no')}")
    calc(aj[a("address")], f'=IF({cref("address")}="","",{cref("address")})')
    calc(aj[a("status")], f'=IF({cref("status")}="","",{cref("status")})')
    calc(aj[D_], f'=IF({cref("price")}="","",{cref("price")})', GBP)
    calc(aj[a("area")], f'=IF(N({cref("area")})=0,"",{cref("area")})', INT)
    du = cref("dateused")
    calc(aj[a("hpisale")],
         f'=IF(OR({D_}="",{du}=""),"",IFERROR(1/(1/INDEX(HPI!{B_RNG},MATCH(DATE(YEAR({du}),MONTH({du}),1),HPI!{C_RNG},0))),""))', DEC2)
    calc(aj[a("hpival")], f'=IF(OR({D_}="",N(HPI!$B$11)=0),"",HPI!$B$11)', DEC2)
    calc(aj[a("factor")],
         f'=IF({D_}="","",IF(OR(N({a("hpisale")})=0,N({a("hpival")})=0,AND($G$6>0,ABS(N({cref("months")}))<=$G$6)),1,{a("hpival")}/{a("hpisale")}))', "0.0000")
    calc(aj[a("tprice")], f'=IF({D_}="","",{D_}*{a("factor")})', GBP)
    calc(aj[a("tgbp")], f'=IF({D_}="","",{a("tprice")}-{D_})', GBP)
    calc(aj[a("tpct")], f'=IF({D_}="","",{a("factor")}-1)', PCT)
    calc(aj[a("areadiff")], f'=IF({cref("areadiff")}="","",{cref("areadiff")})', PCT)
    L_ = a("areadiff")
    calc(aj[a("band")],
         f'=IF({L_}="","",IF({L_}<0,1,IF({L_}>0,-1,0))*IF(ABS({L_})<0.1,0,IF(ABS({L_})<0.2,0.05,IF(ABS({L_})<0.3,0.1,IF(ABS({L_})<0.4,0.15,IF(ABS({L_})<0.5,0.2,0.3))))))', PCT)
    I_ = a("tprice")
    for key, text in FACTORS:
        p, gb, rs, am = (a(f"{key}_{x}") for x in ("pct", "gbp", "reason", "amt"))
        inp(aj[p], ex.get(f"{key}_pct"), PCT, example=f"{key}_pct" in ex)
        inp(aj[gb], ex.get(f"{key}_gbp"), GBP, example=f"{key}_gbp" in ex)
        inp(aj[rs], ex.get(f"{key}_reason"), None, example=f"{key}_reason" in ex, wrap=True)
        if key == "disc":
            auto = f'IF(AND(OR({a("status")}="Asking",{a("status")}="Under offer"),N({cref("sold")})=0),0-N($G$7)*{I_},0)'
            calc(aj[am], f'=IF({D_}="","",IF(N({gb})<>0,{gb},IF(N({p})<>0,N({p})*{I_},{auto})))', GBP)
        else:
            calc(aj[am], f'=IF({D_}="","",IF(N({gb})<>0,{gb},N({p})*{I_}))', GBP)
    amts = [a(f"{k}_amt") for k, _ in FACTORS]
    calc(aj[a("total")], f'=IF({D_}="","",' + "+".join(amts) + ")", GBP)
    calc(aj[a("adj")], f'=IF({D_}="","",{I_}+{a("total")})', GBP)
    calc(aj[a("adjpps")], f'=IF(OR({D_}="",{a("area")}=""),"",({a("adj")}-{a("size_amt")})/{a("area")})', GBP)
    calc(aj[a("netgbp")], f'=IF({D_}="","",{a("adj")}-{D_})', GBP)
    calc(aj[a("netinc")], f'=IF({D_}="","",{a("netgbp")}/{D_})', PCT)
    calc(aj[a("netex")], f'=IF({D_}="","",{a("total")}/{I_})', PCT)
    abs_sum = "+".join(f"ABS({x})" for x in amts)
    calc(aj[a("gross")], f'=IF({D_}="","",({abs_sum})/{I_}+IF($G$5="Yes",ABS({a("tgbp")})/{D_},0))', PCT)
    calc(aj[a("largest")], f'=IF({D_}="","",MAX(' + ",".join(f"ABS({x})" for x in amts) + f")/{I_})", PCT)
    calc(aj[a("count")], f'=IF({D_}="","",' + "+".join(f"({x}<>0)" for x in amts) + ")", INT)
    both = "+".join(f'AND(N({a(k + "_pct")})<>0,N({a(k + "_gbp")})<>0)*1' for k, _ in FACTORS)
    work_parts = [
        f'IF(ROUND({a("gross")},6)>$G$3,"Gross adjustment over threshold, comparable may not be reliable. ","")',
        f'IF(ROUND({a("largest")},6)>$G$4,"One adjustment is over "&TEXT($G$4,"0%")&". ","")',
        f'IF(ABS({a("tpct")})>0.05,"Large HPI adjustment, over 5%, please note. ","")',
        f'IF(AND({du}<>"",OR($G$6=0,ABS(N({cref("months")}))>$G$6),OR(N({a("hpisale")})=0,N({a("hpival")})=0)),"No HPI figure for the month of sale or the valuation date, so no time adjustment. ","")',
        f'IF(({both})>0,"Both % and £ typed on a line, the £ figure is used. ","")',
        f'IF({a("area")}="","No floor area, size not checked. ","")',
        f'IF(AND(N({a("disc_pct")})=0,N({a("disc_gbp")})=0,N({a("disc_amt")})<>0),"Usual asking or offer discount applied from the setting at the top. ","")',
    ]
    calc(aj[a("work")], f'=IF({D_}="","",' + "&".join(work_parts) + ")", wrap=False)
    calc(aj[a("warn")], f'=IF({D_}="","",IF(LEN({a("work")})=0,"None",TRIM({a("work")})))', wrap=True)
    aj.row_dimensions[row].height = 36 if ex else 15

for key, _ in FACTORS:
    pc, gc = AC[key + "_pct"], AC[key + "_gbp"]
    add_number(aj, f"{pc}{AFIRST}:{pc}{ALAST}", "decimal", -1, 1,
               "Please type a percentage between minus 100% and plus 100%. Type minus 5% as a minus figure, 0.05 below zero.")
    add_number(aj, f"{gc}{AFIRST}:{gc}{ALAST}", "decimal", -10000000, 10000000, "Please type a £ figure.")
    formula = f"AND(N({pc}{AFIRST})<>0,N({gc}{AFIRST})<>0)"
    flag_rule(aj, f"{pc}{AFIRST}:{pc}{ALAST}", formula)
    flag_rule(aj, f"{gc}{AFIRST}:{gc}{ALAST}", formula)
g = AC["gross"]
flag_rule(aj, f"{g}{AFIRST}:{g}{ALAST}", f"AND(ISNUMBER({g}{AFIRST}),ROUND({g}{AFIRST},6)>$G$3)")
w = AC["warn"]
flag_rule(aj, f"{w}{AFIRST}:{w}{ALAST}", f'AND(LEN({w}{AFIRST})>0,{w}{AFIRST}<>"None")')
aj.freeze_panes = "C10"
page(aj, landscape=True)

# =============================================================== Summary
sm = wb.create_sheet("Summary")
title(sm, "Summary of adjusted evidence",
      "Give each comparable a weight from 0 to 5 (0 leaves it out). Only comparables with a weight above 0 are used in the results below")
SUM_COLS = [
    ("no", "No.", 6, None), ("address", "Address", 36, None), ("status", "Evidence status", 13, None),
    ("adj", "Adjusted price (£)", 14, GBP),
    ("pps", "Adjusted price per square metre, before the size adjustment (£)", 14, GBP),
    ("gross", "Gross adjustment %", 11, PCT), ("warn", "Warnings", 40, None),
    ("weight", "Weight (0 to 5)", 10, INT), ("wcheck", "Weight check", 24, None),
    ("wcount", "Weight counted", 10, INT), ("wprice", "Weight times price", 14, GBP),
    ("wpcount", "Weight counted for price per square metre", 12, INT),
    ("wpps", "Weight times price per square metre", 14, GBP),
    ("inprice", "Adjusted price if weighted", 14, GBP),
    ("inpps", "Price per square metre if weighted", 14, GBP),
]
SC = {key: get_column_letter(i + 1) for i, (key, *_r) in enumerate(SUM_COLS)}
for key, text, width, fmt in SUM_COLS:
    header(sm[f"{SC[key]}4"], text)
    sm.column_dimensions[SC[key]].width = width
sm.row_dimensions[4].height = 58
EX_W = [5, 4, 3]
for n, row in enumerate(range(SFIRST, SLAST + 1)):
    arow = AFIRST + n
    s = lambda k: f"{SC[k]}{row}"  # noqa: E731
    calc(sm[s("no")], f"=Adjustments!{A('no', arow)}")
    calc(sm[s("address")], f"=Adjustments!{A('address', arow)}")
    calc(sm[s("status")], f"=Adjustments!{A('status', arow)}")
    calc(sm[s("adj")], f"=Adjustments!{A('adj', arow)}", GBP)
    calc(sm[s("pps")], f"=Adjustments!{A('adjpps', arow)}", GBP)
    calc(sm[s("gross")], f"=Adjustments!{A('gross', arow)}", PCT)
    calc(sm[s("warn")], f"=Adjustments!{A('warn', arow)}", wrap=True)
    ex = n < len(EX_W)
    inp(sm[s("weight")], EX_W[n] if ex else None, INT, example=ex)
    H_ = s("weight")
    D_ = s("adj")
    calc(sm[s("wcheck")],
         f'=IF({D_}="","",IF({H_}="","No weight typed, so left out.",IF(NOT(ISNUMBER({H_})),"Weight is not a number, so left out.",IF(OR({H_}<0,{H_}>5,{H_}<>INT({H_})),"Weight must be a whole number from 0 to 5.",""))))', wrap=True)
    calc(sm[s("wcount")], f'=IF(OR({D_}="",NOT(ISNUMBER({H_}))),0,MIN(5,MAX(0,INT({H_}))))', INT)
    calc(sm[s("wprice")], f'=IF(OR({D_}="",{s("wcount")}=0),0,{s("wcount")}*{D_})', GBP)
    calc(sm[s("wpcount")], f'=IF({s("pps")}="",0,{s("wcount")})', INT)
    calc(sm[s("wpps")], f'=IF(OR({s("pps")}="",{s("wpcount")}=0),0,{s("wpcount")}*{s("pps")})', GBP)
    calc(sm[s("inprice")], f'=IF(AND({D_}<>"",{s("wcount")}>0),{D_},"")', GBP)
    calc(sm[s("inpps")], f'=IF(AND({s("pps")}<>"",{s("wcount")}>0),{s("pps")},"")', GBP)
    sm.row_dimensions[row].height = 30 if ex else 15
add_number(sm, f"{SC['weight']}{SFIRST}:{SC['weight']}{SLAST}", "whole", 0, 5,
           "Please type a whole number from 0 to 5.", prompt="Type a whole number from 0 to 5. 0 leaves the comparable out.")
flag_rule(sm, f"{SC['gross']}{SFIRST}:{SC['gross']}{SLAST}",
          f"AND(ISNUMBER({SC['gross']}{SFIRST}),ROUND({SC['gross']}{SFIRST},6)>Adjustments!$G$3)")
flag_rule(sm, f"{SC['wcheck']}{SFIRST}:{SC['wcheck']}{SLAST}", f"LEN({SC['wcheck']}{SFIRST})>0")


def rng(key):
    return f"${SC[key]}${SFIRST}:${SC[key]}${SLAST}"


SUMROW = {}
r = 18


def section(text):
    global r
    sm.merge_cells(f"B{r}:D{r}")
    header(sm[f"B{r}"], text, wrap=False)
    r += 1


def result(key, text, formula, fmt=None, wrap=False, merge=False, input_cell=False, value=None, border=BOX):
    global r
    SUMROW[key] = r
    label(sm[f"B{r}"], text)
    if merge:
        sm.merge_cells(f"D{r}:G{r}")
    if input_cell:
        inp(sm[f"D{r}"], value, fmt, wrap=wrap, border=border)
    else:
        calc(sm[f"D{r}"], formula, fmt, wrap=wrap)
    if merge and wrap:
        sm.row_dimensions[r].height = 30
    r += 1


INP, INPPS = rng("inprice"), rng("inpps")
section("Results from the adjusted prices (weighted comparables only)")
result("count", "Comparables with a weight above 0", f"=COUNT({INP})", INT)
result("wavg", "Weighted average adjusted price",
       f'=IF(SUM({rng("wcount")})=0,"",SUM({rng("wprice")})/SUM({rng("wcount")}))', GBP)
result("avg", "Simple average adjusted price", f'=IF(COUNT({INP})=0,"",AVERAGE({INP}))', GBP)
result("median", "Median adjusted price", f'=IF(COUNT({INP})=0,"",MEDIAN({INP}))', GBP)
result("low", "Range low (lowest adjusted price)", f'=IF(COUNT({INP})=0,"",MIN({INP}))', GBP)
result("high", "Range high (highest adjusted price)", f'=IF(COUNT({INP})=0,"",MAX({INP}))', GBP)
result("width", "Range width", f'=IF(D{SUMROW["high"]}="","",D{SUMROW["high"]}-D{SUMROW["low"]})', GBP)
r += 0
section("Results from price per square metre (a cross check)")
note(sm[f"E{r - 1}"], "Worked out before the size adjustment, so size is not counted twice", wrap=False)
result("sarea", "Subject floor area (square metres)", f'=IF(N({SAREA})=0,"",{SAREA})', INT)
result("wpps", "Weighted average price per square metre",
       f'=IF(SUM({rng("wpcount")})=0,"",SUM({rng("wpps")})/SUM({rng("wpcount")}))', GBP)
result("mpps", "Median price per square metre", f'=IF(COUNT({INPPS})=0,"",MEDIAN({INPPS}))', GBP)
result("swpps", "Subject at the weighted price per square metre",
       f'=IF(OR(D{SUMROW["wpps"]}="",D{SUMROW["sarea"]}=""),"",D{SUMROW["wpps"]}*D{SUMROW["sarea"]})', GBP)
result("smpps", "Subject at the median price per square metre",
       f'=IF(OR(D{SUMROW["mpps"]}="",D{SUMROW["sarea"]}=""),"",D{SUMROW["mpps"]}*D{SUMROW["sarea"]})', GBP)
result("lpps", "Price per square metre range, low", f'=IF(COUNT({INPPS})=0,"",MIN({INPPS}))', GBP)
result("hpps", "Price per square metre range, high", f'=IF(COUNT({INPPS})=0,"",MAX({INPPS}))', GBP)
section("Checks")
result("completed", "Completed sales with a weight above 0",
       f'=COUNTIFS({rng("status")},"Completed",{rng("wcount")},">0",{rng("adj")},">0")', INT)
result("evwarn", "Evidence warning",
       f'=IF(D{SUMROW["count"]}=0,"No comparable carries any weight yet.",IF(D{SUMROW["completed"]}<3,"Fewer than 3 completed sales carry weight. Consider reporting material valuation uncertainty.",IF(COUNTIFS({rng("wcount")},">0",{rng("gross")},"<="&Adjustments!$G$3)=0,"Every weighted comparable is over the gross adjustment threshold. Consider reporting material valuation uncertainty.","No evidence warnings")))',
       wrap=True, merge=True)
result("wwarn", "Weight check",
       f'=IF(COUNTIF({rng("wcheck")},"?*")>0,"Some weights need checking: see the Weight check column.","Weights look fine")',
       wrap=True, merge=True)
flag_rule(sm, f"D{SUMROW['evwarn']}", f'D{SUMROW["evwarn"]}<>"No evidence warnings"')
flag_rule(sm, f"D{SUMROW['wwarn']}", f'D{SUMROW["wwarn"]}<>"Weights look fine"')
section("Valuer's opinion of value (for the RICS Registered Valuer only)")
result("opinion", "Valuer's opinion of value (£)", None, GBP, input_cell=True, border=BOX_ORANGE)
note(sm[f"G{SUMROW['opinion']}"], "Left blank on purpose: the opinion of value belongs to the valuer", wrap=False)
result("round", "Round to the nearest (£)", None, GBP, input_cell=True, value=5000)
add_number(sm, f"D{SUMROW['round']}", "decimal", 0, 1000000, "Please type a £ figure of 0 or more. 0 means no rounding.")
OP, RN = f"D{SUMROW['opinion']}", f"D{SUMROW['round']}"
result("oround", "Opinion rounded", f'=IF(N({OP})=0,"",IF(N({RN})<=0,{OP},ROUND({OP}/{RN},0)*{RN}))', GBP)
WA = f"D{SUMROW['wavg']}"
result("wround", "Weighted average rounded (for reference only)",
       f'=IF({WA}="","",IF(N({RN})<=0,{WA},ROUND({WA}/{RN},0)*{RN}))', GBP)
LO, HI = f"D{SUMROW['low']}", f"D{SUMROW['high']}"
result("inside", "Is the opinion inside the adjusted range?",
       f'=IF(OR(N({OP})=0,{LO}=""),"",IF(OR(D{SUMROW["oround"]}<{LO},D{SUMROW["oround"]}>{HI}),"Outside the adjusted range: give strong reasons below","Inside the adjusted range"))',
       merge=True)
result("reasons", "Reasons for the opinion (required)", None, None, input_cell=True, wrap=True, merge=True)
sm.row_dimensions[SUMROW["reasons"]].height = 60
for col in "EFG":
    sm[f"{col}{SUMROW['reasons']}"].border = BOX
section("About the job (from the Subject sheet)")
for key, text, fmt in [("client", "Client or lender", None), ("jobref", "Job reference", None),
                       ("purpose", "Purpose of valuation", None), ("basis", "Basis of value", None),
                       ("valdate", "Valuation date", DATE), ("inspdate", "Inspection date", DATE),
                       ("valuer", "Valuer", None), ("prepared", "Prepared on", DATE),
                       ("reviewer", "Reviewed by", None), ("revdate", "Date reviewed", DATE)]:
    result("job_" + key, text, f'=IF({S(key)}="","",{S(key)})', fmt)
sm.freeze_panes = "C5"
page(sm, landscape=True)

# =============================================================== Instructions
ins = wb.create_sheet("Instructions", 0)
title(ins, "Gibsons Surveyors: comparables and adjustments workbook", "How to use this workbook, in five steps")
ADJ_DISC = AC["disc_pct"]
rows = [
    ("Step 1. Fill in the subject",
     "Open the Subject sheet and type into the yellow cells: first the job (client or lender, job reference, purpose, "
     "basis of value, valuation date, inspection date, valuer and, once done, the reviewer and review date), then the "
     "property. The valuation date matters most, because every time adjustment is measured to it."),
    ("Step 2. Add the HPI figures",
     "Open the HPI sheet. Go to the UK House Price Index (UK HPI) at landregistry.data.gov.uk/app/ukhpi, choose the "
     "local authority and the matching property type, and paste the month and index columns into the yellow table. "
     "Paste the months as real dates (for example 01/01/2025, shown as Jan 2025), not as text, or they will not match "
     "and will be shown with a warning colour. Write down the series name and the release date you used. Filling this "
     "table is what switches the time adjustment on: if it is empty, no time adjustment is made."),
    ("Step 3. Add the comparables",
     "Open the Comparables sheet. Paste or type up to 12 comparables, one per row, starting on the first row. You can "
     "copy figures from the Rightmove Surveyor Comparable Tool (SCT) report yourself, or save the SCT PDF report and "
     "give it to Claude, who will fill the rows for you. Please do not ask a browser assistant to read SCT pages for "
     "you unless Gibsons has written consent from Rightmove: the Rightmove terms of use do not allow automated "
     "collection without written consent. For each comparable record the evidence ranking, what the price was checked "
     "with, whether the date is completion or exchange, and where the floor area came from (use the same source as the "
     "subject where you can). For asking prices and offers, put the date listed."),
    ("Step 4. Set the adjustments",
     "Open the Adjustments sheet. For each comparable and each factor, type EITHER a percentage OR a fixed £ figure, "
     "and a short reason. Adjust the comparable towards the subject: if the comparable is better, enter a minus figure "
     "(it shows in brackets); if it is worse, enter a plus figure. If you type both, the £ figure is used and a warning "
     "appears. The time adjustment is worked out for you from the HPI sheet. The suggested size % is a guide only and "
     "is never used unless you type a figure in Size %."),
    ("Step 5. Read the result",
     "Open the Summary sheet. Give each comparable a whole number weight from 0 to 5 (0 leaves it out of every result). "
     "The sheet shows the weighted average, simple average, median and range of the weighted comparables, and the price "
     "per square metre applied to the subject as a cross check. The opinion of value is for the RICS Registered Valuer "
     "alone: type the valuer's opinion of value in the orange bordered cell and the sheet rounds it to the nearest "
     "£5,000 and checks it against the range."),
    ("Example rows",
     "The subject, the job details and comparables 1 to 3 are made up examples in Chelmsford so you can see the "
     "formulas working. They are shown in peach and marked EXAMPLE. Delete them, including the example adjustments, "
     "the example HPI figures and the example weights, before using the workbook for a real job."),
    ("Asking prices and offers",
     "Mark each comparable as Completed, Under offer or Asking. Asking prices and offers are not confirmed sales, so "
     "give them a lower weight. The Adjustments sheet has a line for the usual gap between asking and selling prices: "
     "set the usual discount at the top of that sheet and it is taken off Asking and Under offer rows that have no sold "
     "price, unless you type your own figure on that line. It starts at 0, so nothing is taken off until you set it."),
    ("Warning flags",
     "Cells with a pale yellow fill and red text are warnings to check, not rules. They show, for example, a sale more "
     "than 12 months old, a sale after the valuation date, a comparable more than half a mile away, a floor area from a "
     "different source to the subject, or total adjustments above the threshold you set on the Adjustments sheet (15% "
     "to start with)."),
]
r = 4
for head, body in rows:
    label(ins[f"A{r}"], head)
    ins[f"A{r}"].alignment = Alignment(vertical="top", wrap_text=True)
    note(ins[f"B{r}"], body)
    ins.row_dimensions[r].height = 15 * (len(body) // 105 + 1) + 6
    r += 1
r += 1
label(ins[f"A{r}"], "Colour key")
r += 1
for colour, text, red in [(INPUT, "Light yellow: you type here", False),
                          (FORMULA, "Grey: worked out by formula, please do not type over", False),
                          (ORANGE, "Orange: headings", False),
                          (FLAG, "Pale yellow with red text: a warning to check", True),
                          (EXAMPLE, "Peach: example rows to delete", False)]:
    ins[f"A{r}"].fill = fill(colour)
    ins[f"A{r}"].border = BOX
    note(ins[f"B{r}"], text, color=RED if red else BODY, wrap=False)
    r += 1
r += 1
label(ins[f"A{r}"], "Method notes")
r += 1
method = [
    "Time adjustment: price multiplied by (HPI index at the valuation date divided by HPI index in the month of sale). "
    "It is applied first, on its own line, to any sale more than the number of months set on the Adjustments sheet "
    "away from the valuation date, before or after it (3 to start with, as in the Gibsons method; set 0 to adjust "
    "every sale). Months are counted as whole months, so 14 August to 2 November is 2 months. For asking prices and "
    "offers with no sale date, the date listed is used.",
    "Other adjustments are added together (not compounded). A percentage is applied to the time adjusted price. A "
    "fixed £ figure is added as it is.",
    "Gross adjustment is the total of all adjustments other than time, ignoring whether they are plus or minus, as a "
    "percentage of the time adjusted price (time is added only if you choose Yes on the Adjustments sheet). The net "
    "adjustment excluding time keeps the signs on the same basis, so it is never larger than the gross figure. The "
    "largest single adjustment uses the same basis, so a 10% adjustment shows as 10%. A separate column shows the net "
    "change including time against the price used. RICS does not set limits; the thresholds here are warnings only.",
    "Price per square metre on the Summary sheet is worked out from the adjusted price before the size adjustment, "
    "divided by the comparable's own floor area, so size is not counted twice when it is applied to the subject.",
    "Only comparables with a weight above 0 are used in the Summary results, including the range that the valuer's "
    "opinion of value is checked against.",
    "This follows RICS Comparable evidence in real estate valuation (1st edition, reissued 2023) and the RICS Red Book "
    "(effective 31 January 2025): keep the evidence, its ranking, how each sale was checked, the reasons and the "
    "sources on file so the analysis is clear to anyone reading it later.",
]
for body in method:
    note(ins[f"B{r}"], body)
    ins.row_dimensions[r].height = 15 * (len(body) // 105 + 1) + 6
    r += 1
ins.column_dimensions["A"].width = 28
ins.column_dimensions["B"].width = 110
page(ins)

# ---------------------------------------------------------------- finish
del wb["Sheet"]
order = ["Instructions", "Subject", "HPI", "Comparables", "Adjustments", "Summary"]
wb._sheets = [wb[n] for n in order]
wb.active = 0

if __name__ == "__main__":
    wb.save(OUT)
    print("Saved", OUT)
    print("Subject rows:", SUBJ)
    print("Comparables columns:", CC)
    print("Adjustments columns:", AC)
    print("Summary columns:", SC)
    print("Summary rows:", SUMROW)
