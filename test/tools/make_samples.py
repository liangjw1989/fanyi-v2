# -*- coding: utf-8 -*-
"""make_samples.py — 生成"已知版式"的 DOCX 测试稿（双栏 + 表格 + 标题层级）。

用于给 PDF/DOCX 版式还原算法提供 ground truth：
    python make_samples.py            # 生成 docx
再用 LibreOffice 转成 PDF：
    <node> <cli> convert --input twocol.docx --output twocol.pdf
"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8")

from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "samples")
os.makedirs(OUT, exist_ok=True)


def set_font(run, name="宋体", size=10.5, bold=False, italic=False):
    run.font.name = name
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    rPr = run._element.get_or_add_rPr()
    rf = rPr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rPr.append(rf)
    rf.set(qn("w:eastAsia"), name)
    rf.set(qn("w:ascii"), "Times New Roman")
    rf.set(qn("w:hAnsi"), "Times New Roman")


def para(doc, text, name="宋体", size=10.5, bold=False, align=None, indent_chars=0, space_after=4):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    if indent_chars:
        pf.first_line_indent = Pt(size * indent_chars)
    r = p.add_run(text)
    set_font(r, name, size, bold)
    return p


def heading(doc, text, level=1):
    size = {1: 12, 2: 10.5, 3: 10}[level]
    return para(doc, text, name="黑体", size=size, bold=True, space_after=3)


def set_two_columns(section, num=2, space_twips=300):
    """把节设置为分栏（w:cols）"""
    sectPr = section._sectPr
    cols = sectPr.find(qn("w:cols"))
    if cols is None:
        cols = OxmlElement("w:cols")
        sectPr.append(cols)
    cols.set(qn("w:num"), str(num))
    cols.set(qn("w:space"), str(space_twips))
    cols.set(qn("w:equalWidth"), "1")


def start_two_columns_from(doc, last_para_of_prev_section, num=2, space_twips=300):
    """在指定段落处结束"单栏"节，之后进入双栏节。

    直接操作 OOXML：把当前 sectPr 复制一份挂到这个段落的 pPr 上（作为节结束符），
    再把正文级 sectPr 改成双栏。
    """
    import copy
    body = doc.element.body
    body_sectPr = body.find(qn("w:sectPr"))
    prev = copy.deepcopy(body_sectPr)          # 单栏节 = 当前页面设置
    # 写入段落 pPr
    p = last_para_of_prev_section._p
    pPr = p.get_or_add_pPr()
    old = pPr.find(qn("w:sectPr"))
    if old is not None:
        pPr.remove(old)
    pPr.append(prev)
    # 正文 sectPr 改成双栏
    cols = body_sectPr.find(qn("w:cols"))
    if cols is None:
        cols = OxmlElement("w:cols")
        body_sectPr.append(cols)
    cols.set(qn("w:num"), str(num))
    cols.set(qn("w:space"), str(space_twips))
    cols.set(qn("w:equalWidth"), "1")


def make_two_column_article(path):
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    for attr, v in (("left_margin", 2.2), ("right_margin", 2.2), ("top_margin", 2.0), ("bottom_margin", 2.0)):
        setattr(sec, attr, Cm(v))

    # 通栏标题区
    para(doc, "先天性心脏病患儿围手术期护理质量评价指标体系的构建",
         name="黑体", size=15, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=6)
    para(doc, "张 三，李 四，王 五",
         name="宋体", size=10.5, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    para(doc, "（某某大学附属医院 心脏外科，北京 100000）",
         name="宋体", size=9, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=8)
    para(doc, "【摘要】 目的 构建先天性心脏病患儿围手术期护理质量评价指标体系。"
              "方法 采用文献回顾与德尔菲法，对 30 名专家进行两轮函询。"
              "结果 最终形成包含 3 个一级指标、12 个二级指标和 46 个三级指标的体系。"
              "结论 该指标体系具有较好的科学性与实用性。",
         name="楷体", size=9, align=WD_ALIGN_PARAGRAPH.JUSTIFY, indent_chars=2, space_after=3)
    kw = para(doc, "【关键词】 先天性心脏病；围手术期；护理质量；德尔菲法",
              name="楷体", size=9, align=WD_ALIGN_PARAGRAPH.JUSTIFY, indent_chars=2, space_after=6)
    # 从关键词之后进入双栏
    start_two_columns_from(doc, kw, num=2, space_twips=340)
    sec = doc.sections[1] if len(doc.sections) > 1 else sec

    heading(doc, "1　对象与方法", 1)
    heading(doc, "1.1　研究对象", 2)
    para(doc, "采用便利抽样法，选取 2024 年 1 月至 2025 年 6 月在我院心脏外科行手术治疗的先天性心脏病患儿 "
              "共 216 例作为研究对象。纳入标准：（1）年龄 0～14 岁；（2）经超声心动图确诊；（3）行体外循环下"
              "心内直视手术。排除标准：（1）合并其他严重脏器疾病；（2）资料不完整者。本研究经医院伦理委员会"
              "审批通过（批号：2024-018）。", size=10.5, indent_chars=2)
    heading(doc, "1.2　研究方法", 2)
    para(doc, "首先通过系统检索中国知网、万方、PubMed 等数据库，检索时限为建库至 2024 年 12 月，"
              "初筛获得相关文献 1246 篇，经去重、阅读题目与摘要后纳入 86 篇，最终提取指标条目 78 项。"
              "随后采用德尔菲法进行两轮专家函询，专家纳入标准为：本科及以上学历、中级及以上职称、"
              "从事儿科心脏专科护理或管理工作 10 年以上。", size=10.5, indent_chars=2)
    para(doc, "指标重要性采用 Likert 5 级评分法，变异系数（CV）＜0.25 且肯德尔和谐系数 W 检验"
              "P＜0.05 表示专家意见趋于一致。", size=10.5, indent_chars=2)
    heading(doc, "2　结果", 1)
    heading(doc, "2.1　专家基本情况", 2)
    para(doc, "两轮函询均发放问卷 30 份，回收有效问卷 30 份，有效回收率 100%。专家年龄 "
              "（42.6±7.3）岁，工作年限（19.4±6.8）年。", size=10.5, indent_chars=2)
    para(doc, "表 1　两轮函询专家意见协调程度", name="黑体", size=10.5, bold=True,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)

    # 表格（在双栏里）
    t = doc.add_table(rows=4, cols=4)
    t.style = "Table Grid"
    data = [
        ["轮次", "指标数", "肯德尔和谐系数 W", "χ² 值"],
        ["第一轮", "78", "0.216", "152.36"],
        ["第二轮", "61", "0.342", "198.74"],
        ["最终", "61", "0.386", "221.05"],
    ]
    for i, row in enumerate(data):
        for j, val in enumerate(row):
            cell = t.cell(i, j)
            cell.text = ""
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run(val)
            set_font(r, "宋体", 9, bold=(i == 0))
    para(doc, "注：W 值越大表示专家意见协调程度越高。", size=8, space_after=6)

    heading(doc, "2.2　指标体系构成", 2)
    para(doc, "最终构建的指标体系包含一级指标 3 项（结构质量、过程质量、结果质量），二级指标 12 项，"
              "三级指标 46 项。一级指标权重分别为 0.286、0.428 和 0.286。", size=10.5, indent_chars=2)
    heading(doc, "3　讨论", 1)
    para(doc, "本研究基于“结构—过程—结果”三维质量评价理论框架，结合德尔菲法构建了先天性心脏病患儿"
              "围手术期护理质量评价指标体系，具有较好的理论依据与实践价值。", size=10.5, indent_chars=2)
    para(doc, "参考文献", name="黑体", size=12, bold=True, space_after=3)
    for ref in [
        "[1] 王某某, 李某某. 儿科护理质量评价研究进展[J]. 中华护理杂志, 2023, 58(12): 1495-1500.",
        "[2] Donabedian A. The quality of care: how can it be assessed?[J]. JAMA, 1988, 260(12): 1743-1748.",
        "[3] 张某, 刘某. 德尔菲法在护理指标构建中的应用[J]. 护理研究, 2022, 36(8): 1402-1406.",
    ]:
        para(doc, ref, size=9, space_after=2)

    path = os.path.join(OUT, "twocol.docx")
    doc.save(path)
    print("saved", path)


def make_single_column_report(path):
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    for attr, v in (("left_margin", 2.5), ("right_margin", 2.5), ("top_margin", 2.5), ("bottom_margin", 2.5)):
        setattr(sec, attr, Cm(v))
    para(doc, "护理质量持续改进年度报告", name="黑体", size=16, bold=True,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)
    heading(doc, "一、总体情况", 1)
    para(doc, "本年度共完成护理质量检查 48 次，覆盖全部 26 个临床科室，平均得分为 94.6 分，"
              "较上一年度提升 2.3 分。", indent_chars=2)
    heading(doc, "二、存在问题", 1)
    para(doc, "（1）部分科室交接班记录不规范；（2）高危药品管理存在薄弱环节；"
              "（3）新入职护士急救技能掌握不熟练。", indent_chars=2)
    heading(doc, "三、改进措施", 1)
    para(doc, "针对上述问题，制定如下措施：一是修订交接班制度并组织专项培训；"
              "二是推行高危药品双人核对与智能预警；三是开展急救技能分层培训与考核。", indent_chars=2)
    doc.save(path)
    print("saved", path)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    make_two_column_article(os.path.join(OUT, "twocol.docx"))
    make_single_column_report(os.path.join(OUT, "oncol.docx"))
