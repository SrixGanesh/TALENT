# ============================================================
# Canonical skill taxonomy for the spaCy PhraseMatcher.
#
# Same MASTER_SKILLS list as src/lib/resumeAnalyzer.js (kept in sync
# manually — see README "Keeping skills in sync"), but each skill also
# carries a list of aliases/abbreviations real resumes actually use
# ("k8s" instead of "Kubernetes", "js" instead of "JavaScript", etc).
# The JS regex version only matches the exact canonical word; this is
# the concrete "smarter than a fixed list" upgrade spaCy buys us —
# every alias resolves back to ONE canonical name so scoring/coverage
# math stays simple downstream.
# ============================================================

SKILLS: dict[str, list[str]] = {
    "Go": ["golang"],
    "Kubernetes": ["k8s"],
    "Docker": ["containerization", "docker compose"],
    "gRPC": ["grpc"],
    "Python": ["py"],
    "PyTorch": ["torch"],
    "TensorFlow": ["tf", "keras"],
    "MLOps": ["ml ops", "ml pipelines"],
    "SQL": ["structured query language"],
    "NoSQL": ["no sql", "non-relational database"],
    "Tableau": [],
    "Risk Modeling": ["risk modelling", "risk analysis"],
    "Statistics": ["statistical analysis", "stats"],
    "Figma": [],
    "Design Systems": ["design system"],
    "User Research": ["user testing", "usability testing"],
    "Prototyping": ["prototype", "rapid prototyping"],
    "Wireframing": ["wireframes", "wireframe"],
    "SIEM": ["security information and event management"],
    "Penetration Testing": ["pen testing", "pentest", "pentesting"],
    "ISO 27001": ["iso27001"],
    "Incident Response": ["incident handling"],
    "Network Security": ["network defense"],
    "Firewall Management": ["firewalls"],
    "React": ["react.js", "reactjs"],
    "Vue": ["vue.js", "vuejs"],
    "Angular": ["angular.js", "angularjs"],
    "TypeScript": ["ts"],
    "JavaScript": ["js", "ecmascript"],
    "Tailwind": ["tailwindcss", "tailwind css"],
    "AWS": ["amazon web services"],
    "GCP": ["google cloud platform", "google cloud"],
    "Azure": ["microsoft azure"],
    "Terraform": ["iac", "infrastructure as code"],
    "Java": [],
    "Spring": ["spring boot", "springboot"],
    "MySQL": ["my sql"],
    "PostgreSQL": ["postgres", "psql", "pg"],
    "MongoDB": ["mongo"],
    "SEO": ["search engine optimization", "search engine optimisation"],
    "Content Strategy": ["content planning"],
    "Analytics": ["google analytics", "data analytics"],
    "Excel": ["ms excel", "microsoft excel", "spreadsheets"],
    "Power BI": ["powerbi"],
    "Requirements Mapping": ["requirements gathering", "requirements analysis"],
    "Stakeholder Mgmt": ["stakeholder management"],
    "Node.js": ["nodejs", "node"],
    "GraphQL": ["graph ql"],
    "REST APIs": ["rest api", "restful api", "restful apis"],
    "CI/CD": ["ci cd", "continuous integration", "continuous deployment"],
    "Git": ["github", "gitlab", "version control"],
    "Agile": ["agile methodology", "kanban"],
    "Scrum": ["scrum master"],
    "Machine Learning": ["ml", "machine learning models"],
    "Data Engineering": ["data pipelines", "etl"],
    "Spark": ["apache spark", "pyspark"],
}
