import uuid
from typing import Optional
import networkx as nx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.models import WalletCluster, Developer
from app.utils.logging_config import logger


class WalletClusterEngine:
    def __init__(self):
        self.graph = nx.Graph()

    def add_connection(self, wallet_a: str, wallet_b: str, weight: float = 1.0):
        self.graph.add_edge(wallet_a, wallet_b, weight=weight)

    def add_transaction_link(self, sender: str, receiver: str, amount_usd: float = 0):
        weight = min(amount_usd / 1000, 10) if amount_usd > 0 else 1.0
        self.graph.add_edge(sender, receiver, weight=weight, type="transaction")

    def add_shared_deployer_link(self, wallet_a: str, wallet_b: str):
        self.graph.add_edge(wallet_a, wallet_b, weight=5.0, type="shared_deployer")

    def find_clusters(self) -> list[set]:
        return list(nx.connected_components(self.graph))

    def get_cluster_for_wallet(self, wallet: str) -> Optional[set]:
        if wallet not in self.graph:
            return None
        for component in nx.connected_components(self.graph):
            if wallet in component:
                return component
        return None

    def get_cluster_risk(self, cluster: set) -> dict:
        subgraph = self.graph.subgraph(cluster)
        return {
            "size": len(cluster),
            "density": nx.density(subgraph) if len(cluster) > 1 else 0,
            "wallets": list(cluster),
            "edges": subgraph.number_of_edges(),
        }

    def get_graph_data(self) -> dict:
        nodes = [{"id": n, "degree": self.graph.degree(n)} for n in self.graph.nodes()]
        edges = [
            {"source": u, "target": v, **d}
            for u, v, d in self.graph.edges(data=True)
        ]
        return {"nodes": nodes, "edges": edges}

    async def persist_clusters(self, db: AsyncSession, chain: str):
        clusters = self.find_clusters()

        for cluster_wallets in clusters:
            if len(cluster_wallets) < 2:
                continue

            cluster_id = f"{chain}_{uuid.uuid4().hex[:12]}"
            risk_data = self.get_cluster_risk(cluster_wallets)
            subgraph = self.graph.subgraph(cluster_wallets)

            rug_count = 0
            token_count = 0
            for wallet in cluster_wallets:
                dev_result = await db.execute(
                    select(Developer).where(Developer.wallet_address == wallet)
                )
                dev = dev_result.scalar_one_or_none()
                if dev:
                    rug_count += dev.total_rugs
                    token_count += dev.total_tokens_launched

            risk_score = 0.0
            if token_count > 0:
                risk_score = min((rug_count / token_count) * 100, 100)

            risk_score += min(len(cluster_wallets) * 2, 20)
            risk_score = min(risk_score, 100)

            cluster_type = "benign"
            if risk_score > 70:
                cluster_type = "high_risk"
            elif risk_score > 40:
                cluster_type = "suspicious"

            wc = WalletCluster(
                cluster_id=cluster_id,
                wallets=list(cluster_wallets),
                chain=chain,
                cluster_type=cluster_type,
                risk_score=risk_score,
                total_tokens_associated=token_count,
                total_rugs_associated=rug_count,
                graph_data=risk_data,
            )
            db.add(wc)

        await db.flush()
        logger.info(
            f"[WalletCluster] Persisted {len(clusters)} clusters for {chain}"
        )

    async def analyze_wallet(
        self, db: AsyncSession, wallet_address: str
    ) -> Optional[dict]:
        cluster = self.get_cluster_for_wallet(wallet_address)
        if not cluster:
            return None

        risk_data = self.get_cluster_risk(cluster)

        result = await db.execute(
            select(WalletCluster).where(
                WalletCluster.wallets.contains([wallet_address])
            )
        )
        existing = result.scalar_one_or_none()

        return {
            "wallet": wallet_address,
            "cluster_size": risk_data["size"],
            "cluster_density": risk_data["density"],
            "connected_wallets": risk_data["wallets"],
            "cluster_id": existing.cluster_id if existing else None,
            "cluster_risk": existing.risk_score if existing else None,
            "cluster_type": existing.cluster_type if existing else None,
        }


wallet_cluster_engine = WalletClusterEngine()
