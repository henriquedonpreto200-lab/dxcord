"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { supabase } from "@/lib/supabase";

type Message = {
  id: number;
  user_name: string;
  text: string;
  created_at: string;
};


type VoiceSignal = {
  type: "join" | "offer" | "answer" | "candidate" | "leave";
  from: string;
  to?: string;
  name?: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

function VoiceChannel({ userName }: { userName: string }) {
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [members, setMembers] = useState<string[]>([]);

  const myId = useRef(
    typeof crypto !== "undefined"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  );

  const channelRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Record<string, RTCPeerConnection>>({});
  const namesRef = useRef<Record<string, string>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});

  function sendSignal(payload: VoiceSignal) {
    channelRef.current?.send({
      type: "broadcast",
      event: "signal",
      payload,
    });
  }

  async function createPeer(peerId: string, makeOffer: boolean) {
    if (peersRef.current[peerId]) {
      return peersRef.current[peerId];
    }

    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    peersRef.current[peerId] = peer;

    streamRef.current?.getTracks().forEach((track) => {
      peer.addTrack(track, streamRef.current!);
    });

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;

      sendSignal({
        type: "candidate",
        from: myId.current,
        to: peerId,
        candidate: event.candidate.toJSON(),
      });
    };

    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;

      let audio = audioRefs.current[peerId];

      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.setAttribute("playsinline", "true");
        audioRefs.current[peerId] = audio;
        document.body.appendChild(audio);
      }

      audio.srcObject = stream;
      audio.play().catch(() => {});
    };

    peer.onconnectionstatechange = () => {
      if (
        peer.connectionState === "failed" ||
        peer.connectionState === "disconnected" ||
        peer.connectionState === "closed"
      ) {
        peer.close();
        delete peersRef.current[peerId];

        audioRefs.current[peerId]?.remove();
        delete audioRefs.current[peerId];

        setMembers((old) => old.filter((id) => id !== peerId));
      }
    };

    if (makeOffer) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      sendSignal({
        type: "offer",
        from: myId.current,
        to: peerId,
        name: userName,
        offer,
      });
    }

    return peer;
  }

  async function joinCall() {
    if (connected) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      streamRef.current = stream;

      const channel = supabase.channel("dxcord-voice-geral", {
        config: {
          broadcast: {
            self: false,
          },
        },
      });

      channelRef.current = channel;

      channel.on(
        "broadcast",
        { event: "signal" },
        async ({ payload }: { payload: VoiceSignal }) => {
          if (!payload || payload.from === myId.current) return;

          try {
            if (payload.type === "join") {
              namesRef.current[payload.from] = payload.name || "Usuário";

              setMembers((old) =>
                old.includes(payload.from)
                  ? old
                  : [...old, payload.from]
              );

              await createPeer(payload.from, true);
              return;
            }

            if (payload.type === "offer") {
              if (payload.to !== myId.current) return;

              namesRef.current[payload.from] = payload.name || "Usuário";

              setMembers((old) =>
                old.includes(payload.from)
                  ? old
                  : [...old, payload.from]
              );

              const peer = await createPeer(payload.from, false);

              await peer.setRemoteDescription(
                new RTCSessionDescription(payload.offer!)
              );

              const answer = await peer.createAnswer();
              await peer.setLocalDescription(answer);

              sendSignal({
                type: "answer",
                from: myId.current,
                to: payload.from,
                answer,
              });

              return;
            }

            if (payload.type === "answer") {
              if (payload.to !== myId.current) return;

              const peer = peersRef.current[payload.from];
              if (!peer) return;

              await peer.setRemoteDescription(
                new RTCSessionDescription(payload.answer!)
              );

              return;
            }

            if (payload.type === "candidate") {
              if (payload.to !== myId.current) return;

              const peer = peersRef.current[payload.from];
              if (!peer || !payload.candidate) return;

              await peer.addIceCandidate(
                new RTCIceCandidate(payload.candidate)
              );

              return;
            }

            if (payload.type === "leave") {
              const peer = peersRef.current[payload.from];

              if (peer) {
                peer.close();
                delete peersRef.current[payload.from];
              }

              audioRefs.current[payload.from]?.remove();
              delete audioRefs.current[payload.from];

              setMembers((old) =>
                old.filter((id) => id !== payload.from)
              );
            }
          } catch (error) {
            console.error("Erro na call de voz:", error);
          }
        }
      );

      await channel.subscribe();

      sendSignal({
        type: "join",
        from: myId.current,
        name: userName,
      });

      setConnected(true);
      setMuted(false);
    } catch (error) {
      console.error("Erro ao acessar o microfone:", error);

      alert(
        "Não foi possível acessar o microfone. Permita o acesso ao microfone no navegador e tente novamente."
      );
    }
  }

  async function leaveCall() {
    if (!connected) return;

    sendSignal({
      type: "leave",
      from: myId.current,
    });

    Object.values(peersRef.current).forEach((peer) => peer.close());
    peersRef.current = {};

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    Object.values(audioRefs.current).forEach((audio) => audio.remove());
    audioRefs.current = {};

    if (channelRef.current) {
      await channelRef.current.unsubscribe();
      channelRef.current = null;
    }

    setMembers([]);
    setConnected(false);
    setMuted(false);
  }

  function toggleMute() {
    const tracks = streamRef.current?.getAudioTracks() ?? [];
    if (!tracks.length) return;

    const nextMuted = tracks[0].enabled;

    tracks.forEach((track) => {
      track.enabled = !nextMuted;
    });

    setMuted(nextMuted);
  }

  useEffect(() => {
    return () => {
      Object.values(peersRef.current).forEach((peer) => peer.close());
      streamRef.current?.getTracks().forEach((track) => track.stop());
      Object.values(audioRefs.current).forEach((audio) => audio.remove());

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  return (
    <div className="mt-1 rounded-md bg-[#404249] px-2 py-2">
      <div className="flex items-center gap-2">
        <span className="text-lg">🔊</span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-gray-200">Geral</p>
          <p className="text-xs text-gray-400">
            {connected
              ? `${members.length + 1} conectado(s)`
              : "Canal de voz"}
          </p>
        </div>

        {!connected ? (
          <button
            type="button"
            onClick={joinCall}
            className="rounded bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700"
          >
            Entrar
          </button>
        ) : (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={toggleMute}
              title={muted ? "Ativar microfone" : "Mutar microfone"}
              className="rounded bg-[#2f3136] px-2 py-1.5 hover:bg-[#36393f]"
            >
              {muted ? "🔇" : "🎙️"}
            </button>

            <button
              type="button"
              onClick={leaveCall}
              title="Sair da call"
              className="rounded bg-red-600 px-2 py-1.5 hover:bg-red-700"
            >
              📞
            </button>
          </div>
        )}
      </div>

      {connected && members.length > 0 && (
        <div className="mt-2 border-t border-[#55565c] pt-2">
          {members.map((id) => (
            <div
              key={id}
              className="flex items-center gap-2 py-1 text-xs text-gray-300"
            >
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="truncate">
                {namesRef.current[id] || "Usuário"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const [isLogin, setIsLogin] = useState(true);
  const [user, setUser] = useState<any>(null);

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(true);

  useEffect(() => {
    checkUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setMessages([]);
      return;
    }

    loadMessages();

    const channel = supabase
      .channel("messages-channel")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const newMessage = payload.new as Message;

          setMessages((oldMessages) => {
            if (oldMessages.some((item) => item.id === newMessage.id)) {
              return oldMessages;
            }

            return [...oldMessages, newMessage];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  async function checkUser() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    setUser(session?.user ?? null);
  }

  async function handleAuth() {
    if (!email.trim() || !password.trim()) {
      alert("Digite seu e-mail e sua senha.");
      return;
    }

    if (!isLogin && !name.trim()) {
      alert("Digite seu nome.");
      return;
    }

    if (password.length < 6) {
      alert("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    setLoading(true);

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        alert(error.message);
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            display_name: name.trim(),
          },
        },
      });

      if (error) {
        alert(error.message);
      } else if (data.user) {
        alert(
          "Conta criada! Confira seu e-mail para confirmar a conta."
        );

        setName("");
        setEmail("");
        setPassword("");
        setIsLogin(true);
      }
    }

    setLoading(false);
  }

  async function logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      alert("Não foi possível sair.");
      console.error(error);
      return;
    }

    setUser(null);
    setMessages([]);
    setMessage("");
  }

  async function loadMessages() {
    setChatLoading(true);

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Erro ao carregar mensagens:", error);
      setChatLoading(false);
      return;
    }

    setMessages(data ?? []);
    setChatLoading(false);
  }

  async function sendMessage() {
    const cleanMessage = message.trim();

    if (!cleanMessage || !user) {
      return;
    }

    const userName =
      user.user_metadata?.display_name ||
      user.email?.split("@")[0] ||
      "Usuário";

    const { error } = await supabase.from("messages").insert({
      user_name: userName,
      text: cleanMessage,
    });

    if (error) {
      console.error("Erro ao enviar mensagem:", error);
      alert("Não foi possível enviar a mensagem.");
      return;
    }

    setMessage("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      sendMessage();
    }
  }

  // TELA DE LOGIN / CADASTRO
  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#313338] p-4">
        <div className="w-full max-w-md rounded-lg bg-[#2b2d31] p-8 shadow-2xl">
          <h1 className="mb-2 text-center text-3xl font-bold text-white">
            DXCORD
          </h1>

          <p className="mb-8 text-center text-gray-400">
            {isLogin
              ? "Entre na sua conta"
              : "Crie sua conta"}
          </p>

          {!isLogin && (
            <div className="mb-4">
              <label className="mb-2 block text-xs font-bold text-gray-300">
                NOME
              </label>

              <input
                type="text"
                placeholder="Seu nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded bg-[#1e1f22] p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          <div className="mb-4">
            <label className="mb-2 block text-xs font-bold text-gray-300">
              E-MAIL
            </label>

            <input
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded bg-[#1e1f22] p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="mb-6">
            <label className="mb-2 block text-xs font-bold text-gray-300">
              SENHA
            </label>

            <input
              type="password"
              placeholder="Sua senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAuth();
                }
              }}
              className="w-full rounded bg-[#1e1f22] p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <button
            onClick={handleAuth}
            disabled={loading}
            className="w-full rounded bg-indigo-500 p-3 font-bold text-white transition hover:bg-indigo-600 disabled:opacity-50"
          >
            {loading
              ? "Carregando..."
              : isLogin
                ? "Entrar"
                : "Criar conta"}
          </button>

          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setName("");
              setEmail("");
              setPassword("");
            }}
            className="mt-4 w-full text-sm text-indigo-300 hover:underline"
          >
            {isLogin
              ? "Ainda não tenho uma conta"
              : "Já tenho uma conta"}
          </button>
        </div>
      </main>
    );
  }

  const currentUserName =
    user.user_metadata?.display_name ||
    user.email?.split("@")[0] ||
    "Usuário";

  return (
    <main className="flex h-screen overflow-hidden bg-[#313338] text-white">

      {/* SERVIDORES */}
      <aside className="flex w-[72px] flex-col items-center gap-3 bg-[#1e1f22] py-3">

        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500 font-bold">
          DC
        </div>

        <div className="h-[2px] w-8 bg-[#35363c]" />

        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#35363c] font-bold">
          S1
        </div>

        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#35363c] text-2xl text-green-400 hover:bg-[#404249]"
        >
          +
        </button>
      </aside>

      {/* CANAIS */}
      <aside className="flex w-60 flex-col bg-[#2b2d31]">

        <div className="flex h-12 items-center border-b border-[#1f2023] px-4 font-bold">
          Meu Servidor
        </div>

        <div className="p-3">

          <p className="mb-2 text-xs font-bold text-gray-400">
            CANAIS DE TEXTO
          </p>

          <div className="rounded bg-[#404249] px-2 py-2">
            # geral
          </div>

          <div className="px-2 py-2 text-gray-400 hover:bg-[#35373c]">
            # bate-papo
          </div>

          <div className="px-2 py-2 text-gray-400 hover:bg-[#35373c]">
            # jogos
          </div>

          <p className="mb-2 mt-5 text-xs font-bold text-gray-400">
            CANAIS DE VOZ
          </p>

          <VoiceChannel userName={currentUserName} />

        </div>

        {/* PERFIL */}
        <div className="mt-auto flex items-center gap-2 bg-[#232428] p-3">

          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-bold">
            {currentUserName.charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {currentUserName}
            </p>

            <p className="text-xs text-gray-400">
              Online
            </p>
          </div>

          <button
            type="button"
            onClick={logout}
            title="Sair"
            className="cursor-pointer rounded p-2 text-gray-400 transition hover:bg-[#404249] hover:text-white"
          >
            🚪
          </button>

        </div>
      </aside>

      {/* CHAT */}
      <section className="flex flex-1 flex-col bg-[#313338]">

        <header className="flex h-12 items-center border-b border-[#26272b] px-4">
          <span className="mr-2 text-gray-400">
            #
          </span>

          <span className="font-bold">
            geral
          </span>
        </header>

        {/* MENSAGENS */}
        <div className="flex-1 overflow-y-auto p-5">

          <div className="mb-10 mt-5">

            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#41434a] text-3xl">
              #
            </div>

            <h1 className="text-3xl font-bold">
              Boas-vindas a #geral!
            </h1>

            <p className="mt-2 text-gray-400">
              Este é o começo do canal #geral.
            </p>

          </div>

          {chatLoading && (
            <p className="text-gray-400">
              Carregando mensagens...
            </p>
          )}

          {!chatLoading && messages.length === 0 && (
            <p className="text-gray-400">
              Nenhuma mensagem ainda.
            </p>
          )}

          <div className="space-y-5">

            {messages.map((item) => (

              <div
                key={item.id}
                className="flex gap-3"
              >

                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold">
                  {item.user_name.charAt(0).toUpperCase()}
                </div>

                <div>

                  <div>

                    <span className="font-semibold">
                      {item.user_name}
                    </span>

                    <span className="ml-2 text-xs text-gray-400">
                      {new Date(
                        item.created_at
                      ).toLocaleTimeString(
                        "pt-BR",
                        {
                          hour: "2-digit",
                          minute: "2-digit",
                        }
                      )}
                    </span>

                  </div>

                  <p className="break-words">
                    {item.text}
                  </p>

                </div>

              </div>

            ))}

          </div>

        </div>

        {/* CAMPO DE MENSAGEM */}
        <div className="p-4">

          <div className="flex items-center rounded-lg bg-[#383a40] px-4">

            <button
              type="button"
              className="mr-3 text-xl text-gray-300"
            >
              +
            </button>

            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Conversar em #geral"
              className="flex-1 bg-transparent py-3 outline-none placeholder:text-gray-400"
            />

            <button
              type="button"
              onClick={sendMessage}
              className="ml-3 font-bold text-indigo-300 hover:text-white"
            >
              Enviar
            </button>

            <span className="ml-3">
              😊
            </span>

          </div>

        </div>

      </section>

      {/* MEMBROS */}
      <aside className="hidden w-60 bg-[#2b2d31] p-4 lg:block">

        <p className="mb-3 text-xs font-bold text-gray-400">
          ONLINE — 1
        </p>

        <div className="flex items-center gap-2 rounded px-2 py-2">

          <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 font-bold">

            {currentUserName.charAt(0).toUpperCase()}

            <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#2b2d31] bg-green-500" />

          </div>

          <span className="truncate">
            {currentUserName}
          </span>

        </div>

      </aside>

    </main>
  );
}