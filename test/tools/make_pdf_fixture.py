# -*- coding: utf-8 -*-
"""make_pdf_fixture.py — 生成"已知版式"的 PDF 测试向量（pdf.js 等价结构）

为什么要它：真实论文 PDF 含版权/隐私，不适合放进公开仓库；
这里用纯标准库手工拼出一页"通栏标题 + 双栏正文 + 表格"的 PDF 版式数据，
位置完全可控，正好用来验证分栏检测、行聚类、表格识别与阅读顺序。

用法：
    python make_pdf_fixture.py <输出.json>
默认输出：test/samples/twocol.synthetic.pdfjs.json
"""
import sys, os, json

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PAGE_W, PAGE_H = 595.3, 841.9


def item(text, x, y, size, width=None, font="SimSun"):
    """构造一条 pdf.js 风格的 text item（y 为基线，向下为正，单位 pt）"""
    w = width if width is not None else len(text) * size
    return {
        "str": text,
        "dir": "ltr",
        "width": w,
        "height": size,
        "transform": [size, 0, 0, size, x, y],
        "pageHeight": PAGE_H,
        "fontName": font,
        "hasEOL": False,
    }


def build_page():
    items = []

    # 通栏标题（居中，宽度接近版心）
    items.append(item("先天性心脏病患儿围手术期护理质量评价指标体系的构建", 88, 70, 15, 420, "SimHei"))
    # 作者 / 单位（居中）
    items.append(item("张 三，李 四，王 五", 230, 92, 10.5, 135, "SimSun"))
    items.append(item("（某某大学附属医院 心脏外科，北京 100000）", 180, 108, 9, 235, "SimSun"))
    # 通栏摘要
    items.append(item("【摘要】 目的 构建先天性心脏病患儿围手术期护理质量评价指标体系。方法 采用文献回顾与德尔菲法，"
                      "对 30 名专家进行两轮函询。结果 最终形成包含 3 个一级指标、12 个二级指标和 46 个三级指标的体系。"
                      "结论 该指标体系具有较好的科学性与实用性。", 62, 132, 9, 470, "KaiTi"))
    items.append(item("【关键词】 先天性心脏病；围手术期；护理质量；德尔菲法", 62, 158, 9, 300, "KaiTi"))

    # ---- 左栏（x 62 起，宽 220）----
    L = 62
    y = 200
    items.append(item("1　对象与方法", L, y, 12, 90, "SimHei")); y += 22
    items.append(item("1.1　研究对象", L, y, 10.5, 80, "SimHei")); y += 18
    for line in [
        "采用便利抽样法，选取 2024 年 1 月至 2025 年 6 月",
        "在我院心脏外科行手术治疗的先天性心脏病患儿共",
        "216 例作为研究对象。纳入标准：（1）年龄 0～14 岁；",
        "（2）经超声心动图确诊；（3）行体外循环下心内直视",
        "手术。排除标准：（1）合并其他严重脏器疾病；",
        "（2）资料不完整者。本研究经医院伦理委员会审批通过。",
    ]:
        items.append(item(line, L, y, 10.5, min(220, len(line) * 10.5))); y += 16
    y += 6
    items.append(item("1.2　研究方法", L, y, 10.5, 80, "SimHei")); y += 18
    for line in [
        "首先通过系统检索中国知网、万方、PubMed 等数据库，",
        "检索时限为建库至 2024 年 12 月，初筛获得相关文献",
        "1246 篇，经去重、阅读题目与摘要后纳入 86 篇，最终",
        "提取指标条目 78 项。随后采用德尔菲法进行两轮专家函询，",
        "专家纳入标准为：本科及以上学历、中级及以上职称。",
    ]:
        items.append(item(line, L, y, 10.5, min(220, len(line) * 10.5))); y += 16

    # ---- 右栏（x 320 起，宽 210）----
    R = 320
    y = 200
    items.append(item("2　结果", R, y, 12, 60, "SimHei")); y += 22
    items.append(item("2.1　专家基本情况", R, y, 10.5, 110, "SimHei")); y += 18
    for line in [
        "两轮函询均发放问卷 30 份，回收有效问卷 30 份，",
        "有效回收率 100%。专家年龄（42.6±7.3）岁，工作",
        "年限（19.4±6.8）年，均具有丰富的儿科心脏专科经验。",
    ]:
        items.append(item(line, R, y, 10.5, min(210, len(line) * 10.5))); y += 16
    y += 6
    # 表格（右栏内，四列）
    items.append(item("表 1　两轮函询专家意见协调程度", 360, y, 10.5, 150, "SimHei")); y += 16
    table = [
        ["轮次", "指标数", "和谐系数 W", "χ² 值"],
        ["第一轮", "78", "0.216", "152.36"],
        ["第二轮", "61", "0.342", "198.74"],
        ["最终", "61", "0.386", "221.05"],
    ]
    colx = [330, 385, 440, 500]
    for row in table:
        for cx, cell in zip(colx, row):
            items.append(item(cell, cx, y, 9, max(18, len(cell) * 9 * 0.55), "SimSun"))
        y += 14
    y += 4
    items.append(item("注：W 值越大表示专家意见协调程度越高。", 320, y, 8, 200, "SimSun")); y += 18
    items.append(item("2.2　指标体系构成", R, y, 10.5, 110, "SimHei")); y += 18
    for line in [
        "最终构建的指标体系包含一级指标 3 项（结构质量、",
        "过程质量、结果质量），二级指标 12 项，三级指标",
        "46 项。一级指标权重分别为 0.286、0.428 和 0.286。",
    ]:
        items.append(item(line, R, y, 10.5, min(210, len(line) * 10.5))); y += 16

    y += 10
    items.append(item("参考文献", R, y, 12, 60, "SimHei")); y += 18
    for ref in [
        "[1] 王某某, 李某某. 儿科护理质量评价研究进展[J]. 中华护理杂志, 2023, 58(12): 1495-1500.",
        "[2] Donabedian A. The quality of care: how can it be assessed?[J]. JAMA, 1988, 260(12): 1743-1748.",
        "[3] 张某, 刘某. 德尔菲法在护理指标构建中的应用[J]. 护理研究, 2022, 36(8): 1402-1406.",
    ]:
        items.append(item(ref, R, y, 9, min(210, len(ref) * 4.5), "SimSun")); y += 14

    styles = {}
    for it in items:
        styles["f_" + it["fontName"]] = {"fontFamily": it["fontName"], "ascent": 0.8, "descent": -0.2}
        it["fontName"] = "f_" + it["fontName"]

    return {"page": 1, "width": PAGE_W, "height": PAGE_H, "styles": styles, "items": items}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "samples", "twocol.synthetic.pdfjs.json")
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    data = [build_page()]
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("wrote %s  (%d items)" % (out, len(data[0]["items"])))


if __name__ == "__main__":
    main()
