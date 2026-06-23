#!/usr/bin/env python3
"""Generate sample PPT file for i-Write demo - Keynote compatible"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from lxml import etree
import os

def set_run_font(run, size_pt, bold=False, color_rgb=None):
    """Explicitly set font properties on the run element"""
    nsmap = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
    rPr = run._r.find('{http://schemas.openxmlformats.org/drawingml/2006/main}rPr')
    if rPr is None:
        rPr = etree.SubElement(run._r, '{http://schemas.openxmlformats.org/drawingml/2006/main}rPr')
    rPr.set('sz', str(int(size_pt * 100)))
    if bold:
        rPr.set('b', '1')
    # Remove any existing fill
    for fill in rPr.findall('{http://schemas.openxmlformats.org/drawingml/2006/main}solidFill'):
        rPr.remove(fill)
    # Add explicit color
    if color_rgb:
        solidFill = etree.SubElement(rPr, '{http://schemas.openxmlformats.org/drawingml/2006/main}solidFill')
        srgbClr = etree.SubElement(solidFill, '{http://schemas.openxmlformats.org/drawingml/2006/main}srgbClr')
        srgbClr.set('val', color_rgb)
    # Add font references
    for tag in ['latin', 'ea', 'cs']:
        existing = rPr.find('{http://schemas.openxmlformats.org/drawingml/2006/main}' + tag)
        if existing is None:
            elem = etree.SubElement(rPr, '{http://schemas.openxmlformats.org/drawingml/2006/main}' + tag)
            if tag == 'latin':
                elem.set('typeface', 'Helvetica Neue')
            else:
                elem.set('typeface', 'PingFang SC')

def add_text_run(tf, text, size_pt, bold=False, color='000000', align=PP_ALIGN.LEFT):
    """Add a paragraph with a run that has explicit font properties"""
    p = tf.add_paragraph()
    p.alignment = align
    run = p.add_run()
    run.text = text
    set_run_font(run, size_pt, bold, color)
    return p

def create_ppt(output_path):
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    # ── Slide 1: Title ──
    slide1 = prs.slides.add_slide(prs.slide_layouts[6])
    txBox = slide1.shapes.add_textbox(Inches(2), Inches(2.5), Inches(9), Inches(2))
    tf = txBox.text_frame
    tf.word_wrap = True

    # First paragraph
    p1 = tf.paragraphs[0]
    p1.alignment = PP_ALIGN.CENTER
    run1 = p1.add_run()
    run1.text = "i-Write 项目周报"
    set_run_font(run1, 44, True, '000000')

    add_text_run(tf, "2026-06-16 ~ 2026-06-20", 20, False, '555555', PP_ALIGN.CENTER)
    add_text_run(tf, "张三 · Tech Lead", 16, False, '888888', PP_ALIGN.CENTER)

    # ── Slide 2: Goals ──
    slide2 = prs.slides.add_slide(prs.slide_layouts[6])
    txBox2 = slide2.shapes.add_textbox(Inches(1), Inches(1), Inches(11), Inches(5))
    tf2 = txBox2.text_frame
    tf2.word_wrap = True

    p2 = tf2.paragraphs[0]
    run2 = p2.add_run()
    run2.text = "本周目标"
    set_run_font(run2, 32, True, '000000')

    for goal in ["1. 完成用户认证模块（OAuth2 + JWT）", "2. 修复 3 个高优 Bug（BUG-201/205/210）", "3. 完成支付系统技术方案设计"]:
        add_text_run(tf2, goal, 22, False, '333333')

    # ── Slide 3: Status Table ──
    slide3 = prs.slides.add_slide(prs.slide_layouts[6])
    txBox3 = slide3.shapes.add_textbox(Inches(1), Inches(0.5), Inches(11), Inches(1))
    tf3 = txBox3.text_frame
    p3 = tf3.paragraphs[0]
    run3 = p3.add_run()
    run3.text = "完成情况"
    set_run_font(run3, 32, True, '000000')

    # Table
    table = slide3.shapes.add_table(9, 3, Inches(1), Inches(1.5), Inches(11), Inches(5)).table

    # Header
    for i, h in enumerate(["任务", "状态", "负责人"]):
        cell = table.cell(0, i)
        p = cell.text_frame.paragraphs[0]
        run = p.add_run()
        run.text = h
        set_run_font(run, 14, True, '000000')

    # Data
    data = [
        ["认证模块 OAuth2", "✅ 完成", "张三"],
        ["Microsoft OAuth2", "✅ 完成", "张三、李四"],
        ["GitHub OAuth", "✅ 完成", "李四"],
        ["登录页面 UI", "✅ 完成", "王五"],
        ["BUG-201/205/210", "✅ 完成", "王五、李四"],
        ["E2E 测试", "🔄 80%", "赵六"],
        ["支付系统方案", "✅ 完成", "张三、李四"],
        ["Token 刷新修复", "✅ 完成", "李四"],
    ]
    for r, row in enumerate(data, 1):
        for c, text in enumerate(row):
            cell = table.cell(r, c)
            p = cell.text_frame.paragraphs[0]
            run = p.add_run()
            run.text = text
            set_run_font(run, 14, False, '333333')

    # ── Slide 4: Metrics ──
    slide4 = prs.slides.add_slide(prs.slide_layouts[6])
    txBox4 = slide4.shapes.add_textbox(Inches(1), Inches(0.5), Inches(11), Inches(1))
    tf4 = txBox4.text_frame
    p4 = tf4.paragraphs[0]
    run4 = p4.add_run()
    run4.text = "关键数据"
    set_run_font(run4, 32, True, '000000')

    metrics = [("23", "代码 PR", 1.5), ("3", "Bug 修复", 4.5), ("85%", "测试覆盖率", 7.5), ("100%", "认证模块", 10.5)]
    for value, label, left in metrics:
        txBox = slide4.shapes.add_textbox(Inches(left), Inches(2.5), Inches(2.5), Inches(1))
        tf = txBox.text_frame
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        run = p.add_run()
        run.text = value
        set_run_font(run, 48, True, '1a56db')

        txBox2 = slide4.shapes.add_textbox(Inches(left), Inches(3.8), Inches(2.5), Inches(0.5))
        tf2 = txBox2.text_frame
        p2 = tf2.paragraphs[0]
        p2.alignment = PP_ALIGN.CENTER
        run2 = p2.add_run()
        run2.text = label
        set_run_font(run2, 14, False, '666666')

    # ── Slide 5: Issues ──
    slide5 = prs.slides.add_slide(prs.slide_layouts[6])
    txBox5 = slide5.shapes.add_textbox(Inches(1), Inches(0.5), Inches(11), Inches(1))
    tf5 = txBox5.text_frame
    p5 = tf5.paragraphs[0]
    run5 = p5.add_run()
    run5.text = "遇到的问题与解决方案"
    set_run_font(run5, 32, True, '000000')

    txBox5b = slide5.shapes.add_textbox(Inches(1), Inches(2), Inches(11), Inches(5))
    tf5b = txBox5b.text_frame
    tf5b.word_wrap = True

    issues = [
        ("问题 1: Azure AD redirect_uri 配置", True, 'CC0000'),
        ("→ 一个 App Registration 配多个 uri，用环境变量区分", False, '008800'),
        ("", False, '000000'),
        ("问题 2: Token 刷新竞态条件", True, 'CC0000'),
        ("→ 队列机制：刷新中请求排队等待，刷新后用新 Token 重发", False, '008800'),
        ("", False, '000000'),
        ("问题 3: GitHub OAuth 回调超时", True, 'CC0000'),
        ("→ 增加超时到 10s + 重试机制", False, '008800'),
    ]
    for text, bold, color in issues:
        add_text_run(tf5b, text, 18, bold, color)

    # ── Slide 6: Next Week ──
    slide6 = prs.slides.add_slide(prs.slide_layouts[6])
    txBox6 = slide6.shapes.add_textbox(Inches(1), Inches(0.5), Inches(11), Inches(1))
    tf6 = txBox6.text_frame
    p6 = tf6.paragraphs[0]
    run6 = p6.add_run()
    run6.text = "下周计划"
    set_run_font(run6, 32, True, '000000')

    txBox6b = slide6.shapes.add_textbox(Inches(1), Inches(2), Inches(11), Inches(4))
    tf6b = txBox6b.text_frame
    tf6b.word_wrap = True

    for plan in ["1. 完成 E2E 测试并修复发现的问题", "2. 支付系统设计评审", "3. 开始支付模块开发", "4. 更新技术文档"]:
        add_text_run(tf6b, plan, 22, False, '333333')

    # Save
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    prs.save(output_path)
    print(f"  ✅ {os.path.basename(output_path)}")

if __name__ == "__main__":
    output_dir = os.path.join(os.getcwd(), "samples", "presentations")
    output_path = os.path.join(output_dir, "项目周报-2026-06-20.pptx")
    create_ppt(output_path)
    print("PPT 生成完成！")
