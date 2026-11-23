"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { HomeView, MutationResult } from "@/contracts/views";
import type { SceneId } from "@/contracts/scene";
import {
  createRequestSchema,
  courseInitializationSchema,
  type CreateRequest,
  type CourseInitialization,
} from "@/contracts/requests";
import type { Difficulty } from "@/contracts/difficulty";
import { api } from "@/lib/api";

export type HomeBusy =
  "load" | "initialize" | "create" | "difficulty" | "scene" | null;

// 首页所有请求、互斥和重试逻辑集中在这里，展示组件不直接访问 API。
export function useHome(sceneId: SceneId) {
  const router = useRouter();
  const [home, setHome] = useState<HomeView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<HomeBusy>("load");
  const [pending, setPending] = useState<CreateRequest | null>(null);
  const [coursePlanOpen, setCoursePlanOpen] = useState(false);
  const [failedDifficulty, setFailedDifficulty] = useState<Difficulty | null>(
    null,
  );
  // ref 同步拦截连续点击；busy 只负责界面的加载/禁用状态。
  const lock = useRef(false);
  const operation = useRef<CreateRequest | null>(null);
  const initialization = useRef<CourseInitialization | null>(null);
  const initializationKey = "triptalk:pending-course:" + sceneId;
  const key = "triptalk:pending-topic:" + sceneId;
  // 只暂存未确认的创建请求，不把 sessionStorage 当作学习记录。
  function remember(value: CreateRequest | null) {
    operation.current = value;
    setPending(value);
    try {
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    } catch {}
  }
  // 读取已有数据，不生成课程；同步失败时保留待重试请求。
  async function load() {
    if (lock.current) return false;
    lock.current = true;
    setBusy("load");
    setError("");
    try {
      const latest = await api<HomeView>("/home?sceneId=" + sceneId);
      setHome(latest);
      if (!latest.initialized) setCoursePlanOpen(false);
      setFailedDifficulty(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }
  useEffect(() => {
    try {
      const stored = courseInitializationSchema.safeParse(
        JSON.parse(sessionStorage.getItem(initializationKey) ?? "null"),
      );
      if (stored.success && stored.data.sceneId === sceneId)
        initialization.current = stored.data;
    } catch {}
    try {
      const stored = createRequestSchema.safeParse(
        JSON.parse(sessionStorage.getItem(key) ?? "null"),
      );
      if (stored.success && stored.data.sceneId === sceneId)
        remember(stored.data);
    } catch {}
    void load();
    // 页面按 sceneId 设置 key，切换场景会重新挂载；effect 只恢复请求和读取数据。
    // 不把每次渲染都会变化的 load 放进依赖，避免重复加载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (lock.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  // 难度仅影响新主题；有待确认请求时不能改写它原来的难度。
  async function changeDifficulty(difficulty: Difficulty) {
    if (lock.current || pending || !home) return;
    lock.current = true;
    setBusy("difficulty");
    setError("");
    try {
      await api("/preferences", { difficulty }, "PATCH");
      setHome((previous) =>
        previous
          ? {
              ...previous,
              difficulty,
            }
          : previous,
      );
      setFailedDifficulty(null);
    } catch (e) {
      setError((e as Error).message);
      setFailedDifficulty(difficulty);
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }
  async function initialize() {
    if (lock.current) return;
    lock.current = true;
    setBusy("initialize");
    setError("");
    initialization.current ??= { requestId: crypto.randomUUID(), sceneId };
    try {
      sessionStorage.setItem(
        initializationKey,
        JSON.stringify(initialization.current),
      );
    } catch {}
    try {
      await api("/preferences", { lastSceneId: sceneId }, "PATCH");
      // 引导与场景选择是独立用户意图；生成失败也不回滚这两项。
      await api("/onboarding", {}, "PATCH");
      setHome(
        await api<HomeView>("/scenes/initialize", initialization.current),
      );
      initialization.current = null;
      try {
        sessionStorage.removeItem(initializationKey);
      } catch {}
      // 只在这次初始化成功后自动展示；读取、刷新和返回首页不重复弹出。
      setCoursePlanOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }
  // 先保存 lastSceneId 再跳转，失败时停留原场景并显示错误。
  async function changeScene(nextSceneId: SceneId) {
    if (lock.current) return;
    lock.current = true;
    setBusy("scene");
    setError("");
    try {
      await api("/preferences", { lastSceneId: nextSceneId }, "PATCH");
      router.push("/?scene=" + encodeURIComponent(nextSceneId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }
  // 一个入口处理：恢复已有会话 → 初始化目录 → 创建下一主题/明确重练。
  async function start(repeat = false) {
    if (lock.current || !home) return;
    if (home.activeSession && !operation.current) {
      lock.current = true;
      setBusy("scene");
      setError("");
      try {
        await api("/preferences", { lastSceneId: sceneId }, "PATCH");
        router.push("/lessons/" + home.activeSession.id);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        lock.current = false;
        setBusy(null);
      }
      return;
    }
    if (!home.initialized) {
      await initialize();
      return;
    }
    const topicId = repeat ? home.topics[0]?.id : home.nextTopic?.id;
    if (!operation.current && !topicId) return;
    lock.current = true;
    setBusy("create");
    setError("");
    // 响应丢失不等于创建失败：重试必须复用完整请求及 requestId。
    const input = operation.current ?? {
      requestId: crypto.randomUUID(),
      sceneId,
      topicId: topicId!,
      difficulty: home.difficulty,
      ...(repeat ? { repeat: true } : {}),
    };
    remember(input);
    try {
      await api("/preferences", { lastSceneId: sceneId }, "PATCH");
      const result = await api<MutationResult>("/sessions", input);
      remember(null);
      router.push("/lessons/" + result.session.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  function openCoursePlan() {
    if (!lock.current && home?.initialized) setCoursePlanOpen(true);
  }

  function closeCoursePlan() {
    if (!lock.current) setCoursePlanOpen(false);
  }

  async function discardPending() {
    // 先同步服务端，再由用户确认放弃；只清除重试备忘，不删除学习记录。
    if (
      (await load()) &&
      window.confirm(
        "已同步记录。放弃这次创建请求的重试？已保存的学习记录不会删除。",
      )
    ) {
      remember(null);
    }
  }

  function retryDifficulty() {
    if (failedDifficulty) void changeDifficulty(failedDifficulty);
  }

  return {
    home,
    error,
    busy,
    pending,
    failedDifficulty,
    coursePlanOpen,
    startLabel: learningActionLabel(home, Boolean(pending)),
    load,
    changeDifficulty,
    changeScene,
    start,
    openCoursePlan,
    closeCoursePlan,
    discardPending,
    retryDifficulty,
  };
}

function learningActionLabel(home: HomeView | null, pending: boolean) {
  // 首页和弹窗使用同一入口文案，待确认请求始终优先重试原操作。
  if (pending) return "重试原操作";
  if (home?.activeSession) return "继续学习";
  if (!home?.initialized) return "开始场景";
  if (home.sceneCompleted) return "再练一次";
  if (home.completedTopicIds.length > 0) return "学习下一主题";
  return "立即学习";
}
