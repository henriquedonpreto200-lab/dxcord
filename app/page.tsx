"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { supabase } from "@/lib/supabase";

type Message = {
  id: number;
  user_name: string;
  text: string;
  created_at: string;
};

export default function Home() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
            const alreadyExists = oldMessages.some(
              (item) => item.id === newMessage.id
            );

            if (alreadyExists) {
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
  }, []);

  async function loadMessages() {
    setLoading(true);

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Erro ao carregar mensagens:", error);
      setLoading(false);
      return;
    }

    setMessages(data ?? []);
    setLoading(false);
  }

  async function sendMessage() {
    const cleanMessage = message.trim();

    if (!cleanMessage) {
      return;
    }

    const { error } = await supabase.from("messages").insert({
      user_name: "Henri",
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

  return (
    <main className="flex h-screen overflow-hidden bg-[#313338] text-white">
      {/* SERVIDORES */}
      <aside className="flex w-[72px] flex-col items-center gap-3 bg-[#1e1f22] py-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500 font-bold">
          DC
        </div>

        <div className="h-[2px] w-8 bg-[#35363c]" />

        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#313338] font-bold">
          S1
        </div>

        <button className="flex h-12 w-12 items-center justify-center rounded-full bg-[#313338] text-2xl text-green-400">
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

          <div className="px-2 py-2 text-gray-400">
            # bate-papo
          </div>

          <div className="px-2 py-2 text-gray-400">
            # jogos
          </div>

          <p className="mb-2 mt-5 text-xs font-bold text-gray-400">
            CANAIS DE VOZ
          </p>

          <div className="px-2 py-2 text-gray-400">
            🔊 Geral
          </div>
        </div>

        {/* PERFIL */}
        <div className="mt-auto flex h-14 items-center gap-2 bg-[#232428] px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-bold">
            H
          </div>

          <div>
            <p className="text-sm font-semibold">
              Henri
            </p>

            <p className="text-xs text-gray-400">
              Online
            </p>
          </div>

          <div className="ml-auto">
            ⚙️
          </div>
        </div>
      </aside>

      {/* CHAT */}
      <section className="flex flex-1 flex-col bg-[#313338]">
        <header className="flex h-12 items-center border-b border-[#26272b] px-4 font-bold">
          <span className="mr-2 text-gray-400">
            #
          </span>

          geral
        </header>

        {/* MENSAGENS */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mt-10">
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

          <div className="mt-10 space-y-5">
            {loading && (
              <p className="text-gray-400">
                Carregando mensagens...
              </p>
            )}

            {!loading && messages.length === 0 && (
              <p className="text-gray-400">
                Nenhuma mensagem ainda.
              </p>
            )}

            {messages.map((item) => (
              <div
                key={item.id}
                className="flex gap-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold">
                  H
                </div>

                <div>
                  <div>
                    <span className="font-semibold">
                      {item.user_name}
                    </span>

                    <span className="ml-2 text-xs text-gray-400">
                      {new Date(
                        item.created_at
                      ).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
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

        {/* CAIXA DE MENSAGEM */}
        <div className="p-4">
          <div className="flex items-center rounded-lg bg-[#383a40] px-4">
            <button className="mr-3 text-xl text-gray-300">
              +
            </button>

            <input
              type="text"
              value={message}
              onChange={(event) =>
                setMessage(event.target.value)
              }
              onKeyDown={handleKeyDown}
              placeholder="Conversar em #geral"
              className="flex-1 bg-transparent py-3 outline-none placeholder:text-gray-400"
            />

            <button
              onClick={sendMessage}
              className="ml-3 text-sm font-bold text-indigo-300 hover:text-white"
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
      <aside className="w-60 bg-[#2b2d31] p-4">
        <p className="mb-3 text-xs font-bold text-gray-400">
          ONLINE — 1
        </p>

        <div className="flex items-center gap-2 rounded px-2 py-2">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 font-bold">
            H

            <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#2b2d31] bg-green-500" />
          </div>

          <span className="text-gray-300">
            Henri
          </span>
        </div>
      </aside>
    </main>
  );
}