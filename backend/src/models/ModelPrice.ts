/**
 * Catálogo de preços por provider + modelo.
 *
 * Fica no BANCO, não no código, por dois motivos:
 *   1. Provedores mudam preço com frequência (os chineses, especialmente), e
 *      cadastrar modelo novo não pode exigir deploy — mesma razão pela qual o
 *      seletor de modelos já busca a lista via API em vez de hardcodar.
 *   2. `effectiveFrom` dá histórico de preço: dá para saber quanto custava um
 *      modelo em março sem depender de memória.
 *
 * ATENÇÃO: este catálogo é o preço CORRENTE. O valor cobrado de fato em cada
 * chamada é congelado na linha de `TokenUsages` no momento do uso — alterar
 * um preço aqui nunca reescreve consumo já registrado.
 */

import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull
} from "sequelize-typescript";

@Table({ tableName: "ModelPrices" })
class ModelPrice extends Model<ModelPrice> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  /** anthropic | openai | groq | openrouter | minimax | deepseek | qwen */
  @AllowNull(false)
  @Column(DataType.STRING(50))
  provider: string;

  /** Identificador exato do modelo na API do provider */
  @AllowNull(false)
  @Column(DataType.STRING(120))
  model: string;

  /**
   * Preços em USD por 1 MILHÃO de tokens — a unidade que todos os provedores
   * publicam. DECIMAL(12,6) e não FLOAT: preço é dinheiro, e binário
   * flutuante acumula erro quando somado sobre milhares de chamadas.
   */
  @AllowNull(false)
  @Column({ type: DataType.DECIMAL(12, 6), defaultValue: 0 })
  inputPricePerMillion: number;

  @AllowNull(false)
  @Column({ type: DataType.DECIMAL(12, 6), defaultValue: 0 })
  outputPricePerMillion: number;

  /**
   * Preço do token de entrada servido por cache (prompt caching).
   * Tipicamente ~10% do preço de entrada. Ainda não usamos caching, mas o
   * campo existe desde o início para que a economia fique mensurável quando
   * ativarmos — é a maior alavanca de custo desta arquitetura.
   */
  @AllowNull(false)
  @Column({ type: DataType.DECIMAL(12, 6), defaultValue: 0 })
  cachedInputPricePerMillion: number;

  /** Desde quando este preço vale. Permite manter histórico. */
  @AllowNull(false)
  @Column({ type: DataType.DATE, defaultValue: DataType.NOW })
  effectiveFrom: Date;

  /** Origem do dado, para auditoria: "docs oficiais 2026-08", etc. */
  @Column({ type: DataType.STRING(255), allowNull: true })
  source: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ModelPrice;
