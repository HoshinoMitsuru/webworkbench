"""循环守卫：检测"死循环"——同一 (工具+参数) 重复调用超过阈值。

为什么单独成模块：死循环是本次核心痛点。仅靠 max_steps 不够（可能刚好在阈值内反复横跳），
必须按"调用签名"判重。命中即让控制器拦截该调用并进入停止/降级。
"""


class LoopGuard:
    def __init__(self, max_repeat: int = 3):
        self.max_repeat = max_repeat
        self.seen: dict = {}

    def is_repeat(self, signature: str) -> bool:
        self.seen[signature] = self.seen.get(signature, 0) + 1
        # 第 max_repeat+1 次起判定为死循环
        return self.seen[signature] > self.max_repeat

    def reset(self):
        self.seen = {}
