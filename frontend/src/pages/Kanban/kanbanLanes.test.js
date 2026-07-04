import {
  calcLaneQuantities,
  agentLaneTickets,
  openLaneTickets,
  tagLaneTickets,
} from "./kanbanLanes";

const tag1 = { id: 1, name: "Urgente", color: "#f00" };
const tag2 = { id: 2, name: "VIP", color: "#00f" };

const tickets = [
  { id: 1, chatbot: true,  tags: [] },           // agente, sem tag
  { id: 2, chatbot: false, tags: [] },            // em aberto
  { id: 3, chatbot: false, tags: [] },            // em aberto
  { id: 4, chatbot: false, tags: [tag1] },        // tag Urgente
  { id: 5, chatbot: true,  tags: [tag1] },        // chatbot + tag (vai para tag)
  { id: 6, chatbot: false, tags: [tag1, tag2] },  // duas tags
];

describe("agentLaneTickets", () => {
  it("retorna apenas tickets com chatbot:true e sem tags", () => {
    const result = agentLaneTickets(tickets);
    expect(result.map(t => t.id)).toEqual([1]);
  });

  it("exclui tickets chatbot que têm tags", () => {
    const result = agentLaneTickets(tickets);
    expect(result.every(t => t.tags.length === 0)).toBe(true);
  });

  it("retorna array vazio quando não há tickets do agente", () => {
    const noAgent = tickets.filter(t => !t.chatbot);
    expect(agentLaneTickets(noAgent)).toHaveLength(0);
  });
});

describe("openLaneTickets", () => {
  it("retorna tickets sem chatbot e sem tags", () => {
    const result = openLaneTickets(tickets);
    expect(result.map(t => t.id)).toEqual([2, 3]);
  });

  it("exclui tickets com chatbot:true mesmo sem tags", () => {
    const result = openLaneTickets(tickets);
    expect(result.every(t => !t.chatbot)).toBe(true);
  });

  it("exclui tickets que têm tags", () => {
    const result = openLaneTickets(tickets);
    expect(result.every(t => t.tags.length === 0)).toBe(true);
  });
});

describe("tagLaneTickets", () => {
  it("retorna tickets que contêm a tag especificada", () => {
    const result = tagLaneTickets(tickets, 1);
    expect(result.map(t => t.id)).toEqual([4, 5, 6]);
  });

  it("retorna apenas tickets com a tag2", () => {
    const result = tagLaneTickets(tickets, 2);
    expect(result.map(t => t.id)).toEqual([6]);
  });

  it("retorna array vazio para tag inexistente", () => {
    expect(tagLaneTickets(tickets, 999)).toHaveLength(0);
  });
});

describe("calcLaneQuantities", () => {
  const tags = [tag1, tag2];

  it("conta corretamente a lane ai", () => {
    expect(calcLaneQuantities(tickets, tags)["ai"]).toBe(1);
  });

  it("conta corretamente a lane 0 (em aberto)", () => {
    expect(calcLaneQuantities(tickets, tags)["0"]).toBe(2);
  });

  it("conta corretamente tickets por tag", () => {
    const q = calcLaneQuantities(tickets, tags);
    expect(q["1"]).toBe(3); // tickets 4, 5, 6
    expect(q["2"]).toBe(1); // ticket 6
  });

  it("retorna zero para lanes sem tickets", () => {
    const q = calcLaneQuantities([], tags);
    expect(q["ai"]).toBe(0);
    expect(q["0"]).toBe(0);
    expect(q["1"]).toBe(0);
  });

  it("lanes ai + 0 não se sobrepõem (tickets sem tag são mutualmente exclusivos)", () => {
    const q = calcLaneQuantities(tickets, []);
    const semTag = tickets.filter(t => t.tags.length === 0).length;
    expect(q["ai"] + q["0"]).toBe(semTag);
  });
});
