"""
月球基地 v2 后端（Vercel Serverless Function）
- 无状态：不保存会话，每次请求都依赖前端传过来的完整 state。
- 路由：/api/agent（开放式追问）、/api/summary（可行性简报）、
        /api/compare（多基地对比）、/api/story（基地一日叙事）、
        /api/poster（招募海报）、/api/suggest（下一步建议）。
"""

import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# 本地开发时从 .env.local 加载环境变量；Vercel 上由平台注入，此调用无影响。
load_dotenv(".env.local")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Moon Base Agent API", version="2.0.0")

# 允许本地开发与 Vercel 同源调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DeepSeek 通过 openai 库调用
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
MODEL = "deepseek-chat"

if DEEPSEEK_API_KEY:
    from openai import OpenAI

    client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
else:
    client = None


class AgentRequest(BaseModel):
    state: dict[str, Any]
    question: str


class SummaryRequest(BaseModel):
    state: dict[str, Any]
    history: list[dict[str, Any]]


class CompareRequest(BaseModel):
    states: list[dict[str, Any]]


class SimpleStateRequest(BaseModel):
    state: dict[str, Any]


DOMAIN_KNOWLEDGE = """你是月球基地领域的专家顾问，熟悉月球四大候选基地的特点：

1. 沙克尔顿环形山（Shackleton，月球南极）
- 坑口边缘几乎全年有光照（永昼），是布设太阳能与通信设备的理想位置。
- 坑底永久阴影区富含水冰，可就地开采用于饮用水、氧气和火箭推进剂。
- 主要挑战：极端低温（可低于 -220°C）、崎岖地形、月尘、无大气辐射屏蔽、14 个地球日的月夜。

2. 静海（Tranquility，赤道附近）
- 阿波罗 11 号登月点，具有重大历史与科普旅游价值。
- 日照充沛、地形平缓，太阳能收益最高。
- 水冰资源极度稀缺，长期居住必须依赖循环水回收或昂贵地球补给。

3. 雨海（Imbrium，中纬度）
- 玄武岩富含钛铁矿与氦-3，是月球工业化与资源开采的首选。
- 工业用电需求大，月夜相对较长。
- 适合自动化采矿、冶炼与深空补给枢纽。

4. 第谷（Tycho，月球高地）
- 高海拔、地质年轻、陨石坑地貌壮观。
- 天文观测条件优异，是射电与光学望远镜阵列的理想选址。
- 地形复杂、运输与基建成本高。

用户正在做一个交互式沙盘，会依次做六个决策：
1. 能源：核能（稳定大功率、重）、大规模储能（依赖充电窗口）、太阳能（轻但受月夜限制）。
2. 水源：ISRU 就地采水冰（受冰储量限制）、地球补给（昂贵脆弱）、循环水回收（适合低冰区）。
3. 辐射防护：埋入月壤（屏蔽好工程量大）、熔岩洞（天然屏蔽未知多）、加厚舱壁（快速但屏蔽有限）。
4. 通信网络：激光通信（高带宽高指向要求）、中继卫星（覆盖盲区需轨道设施）、直联地球（简单但带宽受限）。
5. 生命维持与食品：全封闭农场（高自给复杂）、地球补给食品（依赖补给）、藻类蛋白管（快速但单一）。
6. 交通运输：月面跳跃器（灵活）、质量投射器（大宗高效高成本）、地表缆车（固定路线低能耗）。

你的回答要基于当前 state 里用户已经选择的配置，解释“如果这样选会怎样”，用中文作答，控制在 400 字以内，语气专业但易懂。如果用户询问不同基地，要针对具体基地特点分析。"""

SUMMARY_PROMPT = """你是一名月球基地可行性评估专家。请根据用户当前的基地配置，生成一份简洁的「基地可行性简报」。

要求：
- 用中文，分「配置摘要」「关键指标」「优势」「风险」「总体结论」几个小节。
- 基于用户选择的选址和六个决策展开，不要编造 state 里没有的选项。
- 给出明确、可执行的评估，控制在 800 字以内。
- 如果能源结余为负、辐射剂量过高或水源不足，要在风险里重点指出。"""

COMPARE_PROMPT = """你是一名月球基地选址顾问。用户已经给出了 2-4 个不同基地的配置与推演指标，请生成一份「多基地对比报告」。

要求：
- 用中文，分「总体推荐」「各基地亮点」「横向对比」「建议」几个小节。
- 基于每个基地的选址特点和所选配置，不要编造数据。
- 控制在 1000 字以内，语气专业。
- 最后给出一个明确的推荐选址及理由。"""

STORY_PROMPT = """你是一名科幻作家兼月球基地顾问。请根据用户当前的基地配置，创作一段 300-500 字的「基地一日」叙事片段。

要求：
- 用中文，以第一人称或第三人称描写基地中普通居民 / 工程师 / 科学家的一天。
- 融入用户选择的能源、水源、辐射防护、通信、食品、交通等技术细节，让选择产生代入感。
- 风格真实、克制、富有月球环境氛围（寂静、灰色荒原、长月夜、低重力等）。
- 不要编造 state 里没有的选项。"""

POSTER_PROMPT = """你是一名月球基地宣传文案专家。请根据用户当前的基地配置，生成一段「招募海报文案」。

要求：
- 用中文，包含一句响亮的口号、一段 150 字以内的招募正文、以及 3-5 个核心卖点（每条 10 字以内）。
- 文案风格要有未来感、使命感和月球特色。
- 融入用户选择的基地特点与配置亮点，不要编造数据。"""

SUGGEST_PROMPT = """你是一名月球基地设计顾问。用户当前尚未完成全部决策，请根据已选配置，给出下一步决策建议。

要求：
- 用中文，控制在 250 字以内。
- 指出当前配置的短板（能源、辐射、水源、通信、食品、交通任一）。
- 明确推荐下一个应该选择哪个选项，并给出理由。
- 不要编造 state 里没有的选项。"""


def build_state_context(state: dict[str, Any]) -> str:
    lines = ["当前基地配置："]
    site = state.get("site")
    lines.append(f"- 选址：{site or '未选择'}")
    for key in ["energy", "water", "radiation", "communication", "habitat", "transport"]:
        val = state.get(key)
        lines.append(f"- {key}：{val or '未选择'}")

    metrics = state.get("metrics")
    if metrics:
        lines.append("\n前端推演指标：")
        lines.append(f"- 能源结余：{metrics.get('powerSurplus_kW')} kW")
        lines.append(f"- 总部署质量：{metrics.get('totalMass_t')} t")
        lines.append(f"- 年供水量：{metrics.get('waterSupply_t_y')} t")
        lines.append(f"- 年辐射剂量：{metrics.get('radiation_mSv_y')} mSv")
        lines.append(f"- 综合风险：{metrics.get('riskScore')}/18")
        lines.append(f"- 可持续性：{metrics.get('sustainability')}/30")
        lines.append(f"- 通信评分：{metrics.get('commScore')}/95")
        lines.append(f"- 食品自给率：{metrics.get('foodSelfSufficiency')}%")
        lines.append(f"- 运输能力：{metrics.get('transportCapacity')}/95")
        lines.append(f"- 综合可行性：{metrics.get('viabilityScore')}/100")
    return "\n".join(lines)


def chat_completion(messages: list[dict[str, str]], max_tokens: int = 900) -> str:
    if not client:
        raise RuntimeError("DEEPSEEK_API_KEY 未配置，无法调用模型")

    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=max_tokens,
        )
        return resp.choices[0].message.content or ""
    except Exception as exc:
        raise RuntimeError(f"模型调用失败：{exc}") from exc


def demo_placeholder(action_name: str, extra: str = "") -> str:
    return (
        f"## （演示模式）{action_name}\n\n"
        "当前后端未配置 DEEPSEEK_API_KEY，因此返回占位文本。\n\n"
        f"{extra}\n\n"
        "部署到 Vercel 并在后台填入 API key 后，这里将返回 AI 生成的专业内容。"
    )


@app.get("/api/health")
def health():
    return {"ok": True, "model_available": client is not None, "version": "2.0.0"}


@app.post("/api/agent")
def agent(req: AgentRequest):
    """开放式追问：基于当前 state 回答用户的自由提问。"""
    try:
        if not client:
            return {
                "answer": (
                    "（演示模式）当前后端未配置 DEEPSEEK_API_KEY，无法调用真实模型。\n\n"
                    "你问的是：" + req.question[:200] + "\n\n"
                    "部署到 Vercel 并在后台填入 API key 后，这里将返回 AI 的专业回答。"
                )
            }

        messages = [
            {"role": "system", "content": DOMAIN_KNOWLEDGE},
            {"role": "system", "content": build_state_context(req.state)},
            {"role": "user", "content": req.question},
        ]
        answer = chat_completion(messages, max_tokens=800)
        return {"answer": answer}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/summary")
def summary(req: SummaryRequest):
    """收尾产出：生成基于当前配置的可行性简报。"""
    try:
        if not client:
            return {"result": demo_placeholder("基地可行性简报")}

        history_text = "\n".join(
            f"- {h.get('step')}: {h.get('label')}"
            for h in (req.history or [])
        )

        messages = [
            {"role": "system", "content": SUMMARY_PROMPT},
            {"role": "system", "content": build_state_context(req.state)},
            {"role": "system", "content": f"用户选择历史：\n{history_text or '（无）'}"},
            {"role": "user", "content": "请生成基地可行性简报。"},
        ]
        result = chat_completion(messages, max_tokens=1000)
        return {"result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/compare")
def compare(req: CompareRequest):
    """多基地对比：基于多个 state 生成对比报告。"""
    try:
        if not client:
            return {"result": demo_placeholder("多基地对比报告", "前端会收集各基地配置并传入；接入模型后将生成专业对比。")}

        contexts = []
        for idx, st in enumerate(req.states or [], 1):
            contexts.append(f"=== 基地 {idx} ===\n{build_state_context(st)}")

        messages = [
            {"role": "system", "content": DOMAIN_KNOWLEDGE},
            {"role": "system", "content": COMPARE_PROMPT},
            {"role": "user", "content": "请根据以下配置生成多基地对比报告。\n\n" + "\n\n".join(contexts)},
        ]
        result = chat_completion(messages, max_tokens=1200)
        return {"result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/story")
def story(req: SimpleStateRequest):
    """创意产出：生成基地一日叙事片段。"""
    try:
        if not client:
            return {"result": demo_placeholder("基地一日叙事片段", "基于你的配置，AI 将创作一段有代入感的月球生活故事。")}

        messages = [
            {"role": "system", "content": DOMAIN_KNOWLEDGE},
            {"role": "system", "content": STORY_PROMPT},
            {"role": "system", "content": build_state_context(req.state)},
            {"role": "user", "content": "请创作一段基地一日叙事。"},
        ]
        result = chat_completion(messages, max_tokens=900)
        return {"result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/poster")
def poster(req: SimpleStateRequest):
    """营销产出：生成招募海报文案。"""
    try:
        if not client:
            return {"result": demo_placeholder("招募海报文案", "AI 将基于你的基地配置生成宣传口号与卖点。")}

        messages = [
            {"role": "system", "content": DOMAIN_KNOWLEDGE},
            {"role": "system", "content": POSTER_PROMPT},
            {"role": "system", "content": build_state_context(req.state)},
            {"role": "user", "content": "请生成招募海报文案。"},
        ]
        result = chat_completion(messages, max_tokens=700)
        return {"result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/suggest")
def suggest(req: SimpleStateRequest):
    """决策辅助：根据当前未完成状态建议下一步。"""
    try:
        if not client:
            return {"result": demo_placeholder("下一步决策建议", "AI 会根据你当前的短板推荐下一个最优选择。")}

        messages = [
            {"role": "system", "content": DOMAIN_KNOWLEDGE},
            {"role": "system", "content": SUGGEST_PROMPT},
            {"role": "system", "content": build_state_context(req.state)},
            {"role": "user", "content": "请给出下一步决策建议。"},
        ]
        result = chat_completion(messages, max_tokens=500)
        return {"result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# 本地开发时让 FastAPI 同时托管前端静态文件，访问 http://localhost:8000 即可。
# Vercel 部署后仍由 Vercel 静态托管处理根目录，不会走到这里。
app.mount(
    "/",
    StaticFiles(directory=Path(__file__).parent.parent, html=True),
    name="static",
)
